import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConductRating, EnrollmentStatus, Prisma, Role } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { CONDUCT_ITEMS, ConductSheetQueryDto, ListConductDto, SaveConductSheetDto } from './dto/conduct.dto';

const day = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00.000Z`);
const name = (u?: { firstName: string; lastName: string } | null) => (u ? `${u.firstName} ${u.lastName}`.trim() : '');
const rowInclude = {
  student: { select: { id: true, admissionNo: true, user: { select: { firstName: true, lastName: true } } } },
  section: { select: { id: true, name: true, class: { select: { id: true, name: true } } } },
  assessedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ConductAssessmentInclude;
type Row = Prisma.ConductAssessmentGetPayload<{ include: typeof rowInclude }>;

/** PDF2 Admin 1 Character & Conduct Assessment — admin and teachers rate, students and parents only see it. */
@Injectable()
export class ConductService {
  constructor(private readonly prisma: PrismaService) {}

  /** Admin: every class. Teacher: classes they teach a subject in or are class teacher of. */
  private async sectionIdsFor(user: AuthUser): Promise<string[] | null> {
    if (user.role === Role.ADMIN) return null;
    const t = await this.prisma.teacherProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!t) throw new ForbiddenException();
    const [courses, homeroom] = await Promise.all([
      this.prisma.course.findMany({ where: { teacherId: t.id }, select: { sectionId: true } }),
      this.prisma.section.findMany({ where: { classTeacherId: t.id }, select: { id: true } }),
    ]);
    return [...new Set([...courses.map((c) => c.sectionId), ...homeroom.map((s) => s.id)])];
  }

  private async assertSection(user: AuthUser, sectionId: string) {
    const section = await this.prisma.section.findUnique({ where: { id: sectionId }, include: { class: true } });
    if (!section) throw new NotFoundException('Class not found');
    const allowed = await this.sectionIdsFor(user);
    if (allowed && !allowed.includes(sectionId)) throw new ForbiddenException('You can only assess classes you teach.');
    return section;
  }

  private view(r: Row) {
    return {
      ...r,
      studentName: name(r.student.user),
      classLabel: `${r.section.class.name} · ${r.section.name}`,
      assessedByName: name(r.assessedBy),
    };
  }

  /** Current-year classes the user may assess (pickers). */
  async classes(user: AuthUser) {
    const allowed = await this.sectionIdsFor(user);
    const rows = await this.prisma.section.findMany({
      where: { class: { academicYear: { isCurrent: true } }, ...(allowed ? { id: { in: allowed } } : {}) },
      select: { id: true, name: true, class: { select: { id: true, name: true, level: true } } },
    });
    return rows
      .sort((a, b) => (a.class.level ?? 0) - (b.class.level ?? 0) || a.class.name.localeCompare(b.class.name) || a.name.localeCompare(b.name))
      .map((r) => ({ id: r.id, classId: r.class.id, label: `${r.class.name} · ${r.name}` }));
  }

  /** The sheet to fill: every active student of the class with their record for this period (if any). */
  async sheet(q: ConductSheetQueryDto, user: AuthUser) {
    const section = await this.assertSection(user, q.sectionId);
    const start = day(q.startDate);
    const [enrollments, records] = await Promise.all([
      this.prisma.studentEnrollment.findMany({
        where: { sectionId: q.sectionId, status: EnrollmentStatus.ACTIVE },
        select: { rollNumber: true, student: { select: { id: true, admissionNo: true, user: { select: { firstName: true, lastName: true, avatarKey: true } } } } },
      }),
      this.prisma.conductAssessment.findMany({ where: { sectionId: q.sectionId, period: q.period, startDate: start }, include: rowInclude }),
    ]);
    const students = enrollments
      .map((e) => ({
        studentId: e.student.id,
        name: name(e.student.user),
        avatarKey: e.student.user.avatarKey,
        rollNumber: e.rollNumber,
        admissionNo: e.student.admissionNo,
        assessment: records.find((r) => r.studentId === e.student.id) ?? null,
      }))
      .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }));
    return { section: { id: section.id, label: `${section.class.name} · ${section.name}` }, period: q.period, startDate: start, students };
  }

  async saveSheet(dto: SaveConductSheetDto, user: AuthUser) {
    await this.assertSection(user, dto.sectionId);
    const start = day(dto.startDate);
    const end = day(dto.endDate);
    if (end < start) throw new BadRequestException({ message: 'The end date must be on or after the start date.', fields: { endDate: 'Before the start' } });
    const enrolled = new Set(
      (await this.prisma.studentEnrollment.findMany({ where: { sectionId: dto.sectionId, status: EnrollmentStatus.ACTIVE }, select: { studentId: true } })).map((e) => e.studentId),
    );
    const stranger = dto.rows.find((r) => !enrolled.has(r.studentId));
    if (stranger) throw new BadRequestException('A student in the sheet is not in this class.');
    let saved = 0;
    let removed = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const r of dto.rows) {
        const ratings = Object.fromEntries(CONDUCT_ITEMS.map((k) => [k, (r[k] as ConductRating | undefined) ?? null]));
        const remarks = r.remarks?.trim() || null;
        const key = { studentId_period_startDate: { studentId: r.studentId, period: dto.period, startDate: start } };
        if (!remarks && CONDUCT_ITEMS.every((k) => !ratings[k])) {
          removed += (await tx.conductAssessment.deleteMany({ where: { studentId: r.studentId, period: dto.period, startDate: start } })).count;
          continue;
        }
        const data = { sectionId: dto.sectionId, endDate: end, assessmentDate: day(dto.assessmentDate), ...ratings, remarks, assessedById: user.id };
        await tx.conductAssessment.upsert({ where: key, update: data, create: { studentId: r.studentId, period: dto.period, startDate: start, ...data } });
        saved++;
      }
    });
    return { saved, removed };
  }

  /** Assessment sheet history & reports. */
  async list(q: ListConductDto, user: AuthUser) {
    const allowed = await this.sectionIdsFor(user);
    if (q.sectionId && allowed && !allowed.includes(q.sectionId)) return [];
    const rows = await this.prisma.conductAssessment.findMany({
      where: {
        ...(q.sectionId ? { sectionId: q.sectionId } : allowed ? { sectionId: { in: allowed } } : {}),
        ...(q.classId ? { section: { classId: q.classId } } : {}),
        ...(q.studentId ? { studentId: q.studentId } : {}),
        ...(q.period ? { period: q.period } : {}),
        ...(q.from ? { endDate: { gte: day(q.from) } } : {}),
        ...(q.to ? { startDate: { lte: day(q.to) } } : {}),
      },
      include: rowInclude,
      orderBy: [{ startDate: 'desc' }, { sectionId: 'asc' }],
      take: 5000,
    });
    return rows.map((r) => this.view(r));
  }

  async remove(id: string, user: AuthUser) {
    const r = await this.prisma.conductAssessment.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Record not found');
    await this.assertSection(user, r.sectionId);
    await this.prisma.conductAssessment.delete({ where: { id } });
    return { id };
  }

  /** Student: my records, newest first. */
  async mine(user: AuthUser) {
    const s = await this.prisma.studentProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!s) throw new ForbiddenException('Student profile not found');
    return this.forStudent(s.id);
  }

  /** Parent: a linked child's records. */
  async child(user: AuthUser, studentId: string) {
    const parent = await this.prisma.parentProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!parent) throw new ForbiddenException();
    const link = await this.prisma.parentStudentLink.findFirst({ where: { parentId: parent.id, studentId } });
    if (!link) throw new ForbiddenException('Not a parent of this student');
    return this.forStudent(studentId);
  }

  private async forStudent(studentId: string) {
    const rows = await this.prisma.conductAssessment.findMany({ where: { studentId }, include: rowInclude, orderBy: { startDate: 'desc' }, take: 200 });
    return rows.map((r) => this.view(r));
  }
}
