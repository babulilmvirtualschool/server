import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceStatus, Campus, CertificateType, EnrollmentStatus, InvoiceStatus, Prisma, Role } from '@prisma/client';
import { currentCampus, runUnscoped } from '../../common/campus/campus-context';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCertificateDto, IdCardsQueryDto, ListCertificatesDto, PrefillCertificateDto, UpdateCertificateDto } from './dto/certificates.dto';

const name = (u?: { firstName: string; lastName: string } | null) => (u ? [u.firstName, u.lastName].filter((x) => x && x !== '.').join(' ') : '');
const ymd = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
const day = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00.000Z`);
const STAFF_TYPES: CertificateType[] = [CertificateType.EXPERIENCE];
const OPEN: InvoiceStatus[] = [InvoiceStatus.PENDING, InvoiceStatus.PARTIAL, InvoiceStatus.OVERDUE];

const holderSelect = {
  id: true,
  role: true,
  firstName: true,
  lastName: true,
  gender: true,
  dateOfBirth: true,
  phone: true,
  email: true,
  avatarKey: true,
  isActive: true,
  studentProfile: {
    select: {
      id: true,
      admissionNo: true,
      admissionDate: true,
      bloodGroup: true,
      address: true,
      emergencyPhone: true,
      dischargedAt: true,
      parents: { select: { relation: true, parent: { select: { user: { select: { firstName: true, lastName: true, phone: true } } } } } },
      enrollments: {
        orderBy: { academicYear: { startDate: 'desc' } },
        take: 1,
        select: {
          rollNumber: true,
          status: true,
          section: { select: { id: true, name: true, class: { select: { name: true } } } },
          academicYear: { select: { name: true, startDate: true, endDate: true } },
        },
      },
      discharges: { orderBy: { createdAt: 'desc' }, take: 1, select: { leavingDate: true, reason: true, conduct: true, classAtLeaving: true } },
    },
  },
  teacherProfile: {
    select: {
      id: true,
      employeeCode: true,
      designation: true,
      joiningDate: true,
      qualification: true,
      cnic: true,
      city: true,
      coursesTaught: { select: { subject: { select: { name: true } } } },
    },
  },
} satisfies Prisma.UserSelect;
type Holder = Prisma.UserGetPayload<{ select: typeof holderSelect }>;

/** PDF2 Admin 2 certificates (11 types; the leaving certificate stays with discharge) and Teacher 13 / Student 10 ID cards. */
@Injectable()
export class CertificatesService {
  constructor(private readonly prisma: PrismaService) {}

  private settings() {
    return this.prisma.reportCardSettings
      .findFirst({ select: { schoolName: true, principalName: true, logoKey: true, signatureKey: true } })
      .then((s) => s ?? { schoolName: null, principalName: null, logoKey: null, signatureKey: null });
  }

  private async holder(userId: string): Promise<Holder> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: holderSelect });
    if (!u) throw new NotFoundException('Person not found');
    return u;
  }

  /** The person's printable facts (name, father, class, session, designation ...). */
  private facts(u: Holder) {
    const sp = u.studentProfile;
    const tp = u.teacherProfile;
    const father = sp?.parents.find((p) => p.relation === 'FATHER')?.parent.user;
    const mother = sp?.parents.find((p) => p.relation === 'MOTHER')?.parent.user;
    const enr = sp?.enrollments[0];
    return {
      userId: u.id,
      role: u.role,
      name: name(u),
      gender: u.gender,
      avatarKey: u.avatarKey,
      dateOfBirth: ymd(u.dateOfBirth),
      phone: u.phone,
      ...(sp
        ? {
            studentId: sp.id,
            admissionNo: sp.admissionNo,
            admissionDate: ymd(sp.admissionDate),
            fatherName: name(father),
            fatherPhone: father?.phone ?? null,
            motherName: name(mother),
            motherPhone: mother?.phone ?? null,
            className: enr ? `${enr.section.class.name} ${enr.section.name}` : sp.discharges[0]?.classAtLeaving ?? '',
            sectionId: enr?.section.id ?? null,
            rollNumber: enr?.rollNumber ?? '',
            session: enr?.academicYear.name ?? '',
            bloodGroup: sp.bloodGroup,
            address: sp.address,
            emergencyPhone: sp.emergencyPhone,
            discharged: !!sp.dischargedAt,
          }
        : {}),
      ...(tp
        ? {
            employeeCode: tp.employeeCode,
            designation: tp.designation || (u.role === Role.TEACHER ? 'Teacher' : 'Staff'),
            joiningDate: ymd(tp.joiningDate),
            qualification: tp.qualification,
            cnic: tp.cnic,
            city: tp.city,
            subjects: [...new Set(tp.coursesTaught.map((c) => c.subject.name))].join(', '),
          }
        : {}),
    };
  }

  private assertHolderFits(type: CertificateType, u: Holder) {
    if (STAFF_TYPES.includes(type)) {
      if (!u.teacherProfile) throw new BadRequestException({ message: 'An experience certificate is for teachers and staff.', fields: { userId: 'Choose a teacher or staff member' } });
    } else if (!u.studentProfile) {
      throw new BadRequestException({ message: 'This certificate is for students.', fields: { userId: 'Choose a student' } });
    }
  }

  private async outstanding(studentId: string) {
    const open = await this.prisma.feeInvoice.findMany({ where: { studentId, status: { in: OPEN } }, select: { totalAmount: true, lateFee: true, amountPaid: true } });
    return Math.round(open.reduce((n, i) => n + i.totalAmount + i.lateFee - i.amountPaid, 0) * 100) / 100;
  }

  /** Values the form starts with for a type and person (all editable before issuing). */
  async prefill(q: PrefillCertificateDto) {
    const u = await this.holder(q.userId);
    this.assertHolderFits(q.type, u);
    const f = this.facts(u);
    const sp = u.studentProfile;
    const today = ymd(new Date());
    const details: Record<string, string> = {};
    let outstanding: number | null = null;
    const discharge = sp?.discharges[0];
    switch (q.type) {
      case CertificateType.CHARACTER:
        Object.assign(details, { conduct: discharge?.conduct || 'Good', fromDate: f.admissionDate ?? '', toDate: today });
        break;
      case CertificateType.BONAFIDE:
        details.purpose = '';
        break;
      case CertificateType.TRANSFER:
        Object.assign(details, { leavingDate: ymd(discharge?.leavingDate) || today, reason: discharge?.reason ?? '', transferTo: '', conduct: discharge?.conduct || 'Good' });
        break;
      case CertificateType.MIGRATION:
        Object.assign(details, { leavingDate: ymd(discharge?.leavingDate) || today, migratingTo: '', reason: discharge?.reason ?? '' });
        break;
      case CertificateType.MERIT: {
        const r = sp
          ? await this.prisma.resultSummary.findFirst({
              where: { studentId: sp.id, term: { publishedAt: { not: null } } },
              orderBy: { term: { publishedAt: 'desc' } },
              select: { percent: true, classPosition: true, sectionPosition: true, term: { select: { name: true } } },
            })
          : null;
        const pos = r?.sectionPosition ?? r?.classPosition;
        Object.assign(details, {
          exam: r?.term.name ?? '',
          position: pos ? `${pos}${['th', 'st', 'nd', 'rd'][pos % 100 > 10 && pos % 100 < 14 ? 0 : pos % 10] ?? 'th'}` : '',
          percentage: r?.percent != null ? String(Math.round(r.percent * 10) / 10) : '',
        });
        break;
      }
      case CertificateType.APPRECIATION:
        details.reason = '';
        break;
      case CertificateType.ATTENDANCE: {
        const year = sp?.enrollments[0]?.academicYear;
        const from = year ? ymd(year.startDate) : today;
        const to = year && year.endDate < new Date() ? ymd(year.endDate) : today;
        const recs = sp
          ? await this.prisma.attendanceRecord.groupBy({
              by: ['status'],
              where: { studentId: sp.id, courseId: null, date: { gte: day(from), lte: day(to) } },
              _count: { _all: true },
            })
          : [];
        const total = recs.reduce((n, r) => n + r._count._all, 0);
        const present = recs.filter((r) => r.status === AttendanceStatus.PRESENT || r.status === AttendanceStatus.LATE).reduce((n, r) => n + r._count._all, 0);
        Object.assign(details, { fromDate: from, toDate: to, presentDays: String(present), totalDays: String(total), percentage: total ? String(Math.round((present / total) * 1000) / 10) : '' });
        break;
      }
      case CertificateType.EXPERIENCE:
        Object.assign(details, { designation: f.designation ?? '', subjects: f.subjects ?? '', fromDate: f.joiningDate ?? '', toDate: today, conduct: 'Good' });
        break;
      case CertificateType.FEE_CLEARANCE: {
        outstanding = sp ? await this.outstanding(sp.id) : 0;
        const lastPaid = sp
          ? await this.prisma.feeInvoice.findFirst({ where: { studentId: sp.id, status: InvoiceStatus.PAID }, orderBy: { period: 'desc' }, select: { period: true } })
          : null;
        details.clearedUpTo = lastPaid?.period ?? '';
        break;
      }
      case CertificateType.ACHIEVEMENT:
        Object.assign(details, { achievement: '', event: '', eventDate: '' });
        break;
      case CertificateType.PARTICIPATION:
        Object.assign(details, { event: '', activity: '', eventDate: '' });
        break;
    }
    return { holder: f, details, outstanding };
  }

  private cleanDetails(details: Record<string, unknown>) {
    const out: Record<string, string> = {};
    const entries = Object.entries(details ?? {});
    if (entries.length > 30) throw new BadRequestException('Too many certificate fields.');
    for (const [k, v] of entries) {
      if (!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(k)) throw new BadRequestException(`Invalid certificate field "${k}".`);
      if (v == null) continue;
      if (typeof v !== 'string' && typeof v !== 'number') throw new BadRequestException(`"${k}" must be text.`);
      const s = String(v).trim();
      if (s.length > 1000) throw new BadRequestException(`"${k}" is too long.`);
      out[k] = s;
    }
    return out;
  }

  private async nextNo(tx: Prisma.TransactionClient) {
    const prefix = `${(currentCampus() ?? Campus.ONLINE) === Campus.PHYSICAL ? 'PH' : 'ON'}-CRT-${new Date().getFullYear()}-`;
    const last = await runUnscoped(() =>
      tx.certificate.findFirst({ where: { certificateNo: { startsWith: prefix } }, orderBy: { certificateNo: 'desc' }, select: { certificateNo: true } }),
    );
    return `${prefix}${String((last ? parseInt(last.certificateNo.slice(prefix.length), 10) || 0 : 0) + 1).padStart(4, '0')}`;
  }

  private readonly rowInclude = {
    user: { select: holderSelect },
    issuedBy: { select: { firstName: true, lastName: true } },
  } satisfies Prisma.CertificateInclude;

  private view(c: Prisma.CertificateGetPayload<{ include: CertificatesService['rowInclude'] }>) {
    return {
      id: c.id,
      certificateNo: c.certificateNo,
      type: c.type,
      issueDate: ymd(c.issueDate),
      details: c.details as Record<string, string>,
      remarks: c.remarks,
      createdAt: c.createdAt,
      issuedByName: name(c.issuedBy),
      holder: this.facts(c.user),
    };
  }

  async create(dto: CreateCertificateDto, user: AuthUser) {
    const u = await this.holder(dto.userId);
    this.assertHolderFits(dto.type, u);
    if (dto.type === CertificateType.FEE_CLEARANCE && u.studentProfile) {
      const due = await this.outstanding(u.studentProfile.id);
      if (due > 0) throw new ConflictException(`This student still owes ${due} in fees, so a fee clearance certificate can't be issued.`);
    }
    const details = this.cleanDetails(dto.details);
    for (let attempt = 0; ; attempt++) {
      try {
        const c = await this.prisma.$transaction(async (tx) =>
          tx.certificate.create({
            data: {
              certificateNo: await this.nextNo(tx),
              type: dto.type,
              userId: u.id,
              issueDate: day(dto.issueDate),
              details,
              remarks: dto.remarks?.trim() || null,
              issuedById: user.id,
            },
            include: this.rowInclude,
          }),
        );
        return { ...this.view(c), settings: await this.settings() };
      } catch (e) {
        if (attempt < 2 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
  }

  async update(id: string, dto: UpdateCertificateDto) {
    const c = await this.prisma.certificate.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw new NotFoundException('Certificate not found');
    const row = await this.prisma.certificate.update({
      where: { id },
      data: {
        ...(dto.issueDate ? { issueDate: day(dto.issueDate) } : {}),
        ...(dto.details ? { details: this.cleanDetails(dto.details) } : {}),
        ...(dto.remarks !== undefined ? { remarks: dto.remarks.trim() || null } : {}),
      },
      include: this.rowInclude,
    });
    return this.view(row);
  }

  async remove(id: string) {
    const c = await this.prisma.certificate.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw new NotFoundException('Certificate not found');
    await this.prisma.certificate.delete({ where: { id } });
    return { id };
  }

  async list(q: ListCertificatesDto, extra: Prisma.CertificateWhereInput = {}) {
    const search = q.search?.trim();
    const rows = await this.prisma.certificate.findMany({
      where: {
        ...extra,
        ...(q.type ? { type: q.type } : {}),
        ...(q.userId ? { userId: q.userId } : {}),
        ...(search
          ? {
              OR: [
                { certificateNo: { contains: search, mode: 'insensitive' } },
                { user: { OR: [{ firstName: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }] } },
                { user: { studentProfile: { admissionNo: { contains: search, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
      include: this.rowInclude,
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    return { rows: rows.map((r) => this.view(r)), settings: await this.settings() };
  }

  /** Student / teacher / staff: certificates issued to me. */
  mine(user: AuthUser) {
    return this.list({}, { userId: user.id });
  }

  /** Teacher: certificates of students in classes they teach or are class teacher of (PDF2 Teacher 11). */
  async forTeacher(user: AuthUser, q: ListCertificatesDto) {
    const t = await this.prisma.teacherProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!t) throw new ForbiddenException();
    const enr = await this.prisma.studentEnrollment.findMany({
      where: {
        status: EnrollmentStatus.ACTIVE,
        academicYear: { isCurrent: true },
        section: { OR: [{ classTeacherId: t.id }, { courses: { some: { teacherId: t.id } } }] },
      },
      select: { student: { select: { userId: true } } },
    });
    return this.list(q, { userId: { in: [...new Set(enr.map((e) => e.student.userId))] } });
  }

  async forChild(user: AuthUser, studentId: string) {
    const parent = await this.prisma.parentProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!parent) throw new ForbiddenException();
    const link = await this.prisma.parentStudentLink.findFirst({ where: { parentId: parent.id, studentId }, select: { student: { select: { userId: true } } } });
    if (!link) throw new ForbiddenException('Not a parent of this student');
    return this.list({}, { userId: link.student.userId });
  }

  // ---------------- ID cards ----------------

  async idCards(q: IdCardsQueryDto) {
    const ids = q.userIds ? q.userIds.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 500) : null;
    let where: Prisma.UserWhereInput;
    if (q.kind === 'STUDENT') {
      if (!ids && !q.sectionId) throw new BadRequestException('Choose a class or students.');
      where = {
        role: Role.STUDENT,
        ...(ids ? { id: { in: ids } } : {}),
        ...(q.sectionId ? { studentProfile: { enrollments: { some: { sectionId: q.sectionId, status: EnrollmentStatus.ACTIVE } } } } : {}),
      };
    } else {
      where = { role: { in: [Role.TEACHER, Role.STAFF] }, isActive: true, ...(ids ? { id: { in: ids } } : {}) };
    }
    const users = await this.prisma.user.findMany({ where, select: holderSelect, take: 1000 });
    const cards = users.map((u) => this.cardOf(u));
    cards.sort((a, b) => (Number(a.rollNumber) || 0) - (Number(b.rollNumber) || 0) || a.name.localeCompare(b.name));
    return { cards, settings: await this.settings() };
  }

  private cardOf(u: Holder) {
    const f = this.facts(u);
    const year = u.studentProfile?.enrollments[0]?.academicYear;
    return { ...f, validUntil: year ? ymd(year.endDate) : '' };
  }

  /** Teacher / staff / student: my own card. */
  async myCard(user: AuthUser) {
    const u = await this.holder(user.id);
    return { card: this.cardOf(u), settings: await this.settings() };
  }
}
