import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceApprovalStatus,
  EnrollmentStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AttendanceRecordsQueryDto,
  BulkStaffAttendanceDto,
} from './dto/attendance-admin.dto';
import { BulkMarkAttendanceDto } from './dto/attendance.dto';
import {
  ListTeacherAttendanceDto,
  MarkTeacherAttendanceDto,
  ReviewTeacherAttendanceDto,
} from './dto/teacher-attendance.dto';
import { publicUserSelect } from '../../common/utils/public-user.select';
import { AttendanceRulesService } from './attendance-rules.service';

function parseDateOnly(value: string): Date {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: AttendanceRulesService,
  ) {}

  async bulkMark(user: AuthUser, dto: BulkMarkAttendanceDto) {
    if (!dto.courseId && !dto.sectionId) {
      throw new BadRequestException('Either courseId or sectionId is required');
    }
    // Authorize: TEACHER must own the course or be class teacher of section.
    if (user.role === Role.TEACHER) {
      const t = await this.prisma.teacherProfile.findUnique({
        where: { userId: user.id },
      });
      if (!t) throw new ForbiddenException();
      if (dto.courseId) {
        const c = await this.prisma.course.findUnique({
          where: { id: dto.courseId },
        });
        if (!c || c.teacherId !== t.id) throw new ForbiddenException();
      } else if (dto.sectionId) {
        const s = await this.prisma.section.findUnique({
          where: { id: dto.sectionId },
        });
        if (!s || s.classTeacherId !== t.id) throw new ForbiddenException();
      }
    } else if (user.role !== Role.ADMIN) {
      throw new ForbiddenException();
    }

    const date = new Date(dto.date);
    date.setHours(0, 0, 0, 0);

    // Attendance settings: no marking on closed days / closures; an arrival time decides Present or Late.
    const sectionForRule =
      dto.sectionId ??
      (await this.prisma.course.findUnique({ where: { id: dto.courseId! }, select: { sectionId: true } }))?.sectionId ??
      null;
    const rule = await this.rules.studentDay(dto.date, sectionForRule);
    if (rule.closed) {
      throw new BadRequestException(`School is closed on ${rule.date} (${rule.closed}) — attendance is not taken.`);
    }
    const entries = dto.entries.map((e) => ({
      ...e,
      status: AttendanceRulesService.statusFromArrival(e.status, e.arrivalTime, rule),
      arrivalTime: e.arrivalTime ?? null,
    }));

    return this.prisma.$transaction(async (tx) => {
      const ops = entries.map(async (entry) => {
        // Find existing for idempotent update
        const existing = await tx.attendanceRecord.findFirst({
          where: {
            date,
            studentId: entry.studentId,
            courseId: dto.courseId ?? null,
            sectionId: dto.sectionId ?? null,
          },
        });
        if (existing) {
          return tx.attendanceRecord.update({
            where: { id: existing.id },
            data: {
              status: entry.status,
              remarks: entry.remarks,
              arrivalTime: entry.arrivalTime,
              markedById: user.id,
            },
          });
        }
        return tx.attendanceRecord.create({
          data: {
            date,
            studentId: entry.studentId,
            courseId: dto.courseId ?? null,
            sectionId: dto.sectionId ?? null,
            status: entry.status,
            remarks: entry.remarks,
            arrivalTime: entry.arrivalTime,
            markedById: user.id,
          },
        });
      });
      return Promise.all(ops);
    });
  }

  async listForSectionDate(sectionId: string, date: string) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return this.prisma.attendanceRecord.findMany({
      where: { sectionId, date: d, courseId: null },
      include: {
        student: { include: { user: { select: publicUserSelect } } },
        markedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async listForCourseDate(courseId: string, date: string) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return this.prisma.attendanceRecord.findMany({
      where: { courseId, date: d },
      include: {
        student: { include: { user: { select: publicUserSelect } } },
        markedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  private async resolveCourseReport(courseId: string, date: string) {
    const d = parseDateOnly(date);
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: {
        subject: true,
        section: { include: { class: true } },
        academicYear: true,
        teacher: { include: { user: { select: publicUserSelect } } },
      },
    });
    if (!course) throw new NotFoundException('Course not found');

    const enrollments = await this.prisma.studentEnrollment.findMany({
      where: {
        sectionId: course.sectionId,
        academicYearId: course.academicYearId,
        status: EnrollmentStatus.ACTIVE,
      },
      orderBy: { rollNumber: 'asc' },
    });
    const rollByStudent = new Map(
      enrollments.map((e) => [e.studentId, e.rollNumber]),
    );

    const records = await this.prisma.attendanceRecord.findMany({
      where: { courseId, date: d },
      include: {
        student: { include: { user: { select: publicUserSelect } } },
        markedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const counts = records.reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const markedByNames = [
      ...new Set(
        records
          .map((r) =>
            r.markedBy
              ? `${r.markedBy.firstName} ${r.markedBy.lastName}`.trim()
              : null,
          )
          .filter(Boolean),
      ),
    ];

    return {
      course: {
        id: course.id,
        subject: course.subject,
        section: course.section,
        academicYear: course.academicYear,
        teacher: course.teacher,
      },
      date: d.toISOString().slice(0, 10),
      markedBy: markedByNames,
      total: records.length,
      counts,
      records: records.map((r) => ({
        ...r,
        rollNumber: rollByStudent.get(r.studentId) ?? null,
      })),
    };
  }

  async classReport(user: AuthUser, courseId: string, date: string) {
    if (user.role === Role.TEACHER) {
      const teacher = await this.prisma.teacherProfile.findUnique({
        where: { userId: user.id },
      });
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!teacher || !course || course.teacherId !== teacher.id) {
        throw new ForbiddenException();
      }
    } else if (user.role !== Role.ADMIN) {
      throw new ForbiddenException();
    }
    return this.resolveCourseReport(courseId, date);
  }

  async listSessionsAdmin(from?: string, to?: string, courseId?: string) {
    const where = {
      courseId: courseId ? courseId : { not: null },
      ...(from || to
        ? {
            date: {
              ...(from ? { gte: parseDateOnly(from) } : {}),
              ...(to ? { lte: parseDateOnly(to) } : {}),
            },
          }
        : {}),
    };
    const records = await this.prisma.attendanceRecord.findMany({
      where,
      include: {
        course: {
          include: {
            subject: true,
            section: { include: { class: true } },
            teacher: { include: { user: { select: publicUserSelect } } },
          },
        },
        markedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });

    const sessionMap = new Map<
      string,
      {
        courseId: string;
        date: string;
        course: (typeof records)[0]['course'];
        markedBy: Set<string>;
        counts: Record<string, number>;
        total: number;
      }
    >();

    for (const r of records) {
      if (!r.courseId || !r.course) continue;
      const key = `${r.courseId}:${r.date.toISOString().slice(0, 10)}`;
      let session = sessionMap.get(key);
      if (!session) {
        session = {
          courseId: r.courseId,
          date: r.date.toISOString().slice(0, 10),
          course: r.course,
          markedBy: new Set(),
          counts: {},
          total: 0,
        };
        sessionMap.set(key, session);
      }
      session.total += 1;
      session.counts[r.status] = (session.counts[r.status] ?? 0) + 1;
      if (r.markedBy) {
        session.markedBy.add(
          `${r.markedBy.firstName} ${r.markedBy.lastName}`.trim(),
        );
      }
    }

    return [...sessionMap.values()].map((s) => ({
      courseId: s.courseId,
      date: s.date,
      course: s.course,
      markedBy: [...s.markedBy],
      total: s.total,
      counts: s.counts,
    }));
  }

  async summaryForStudent(
    studentUserId: string,
    from?: string,
    to?: string,
  ) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: studentUserId },
    });
    if (!student) throw new NotFoundException('Student profile not found');
    const where = {
      studentId: student.id,
      ...(from || to
        ? {
            date: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    };
    const records = await this.prisma.attendanceRecord.findMany({
      where,
      orderBy: { date: 'desc' },
      include: { course: { include: { subject: true } }, section: true },
    });
    const counts = records.reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    return {
      total: records.length,
      counts,
      records,
    };
  }

  async markTeacherSelf(user: AuthUser, dto: MarkTeacherAttendanceDto) {
    if (user.role !== Role.TEACHER) throw new ForbiddenException();
    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { userId: user.id },
    });
    if (!teacher) throw new ForbiddenException('Teacher profile not found');

    const date = parseDateOnly(dto.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date > today) {
      throw new BadRequestException('Cannot mark attendance for a future date');
    }
    const rule = (await this.rules.staffDays(dto.date, [teacher.id]))[teacher.id];
    if (rule.closed) {
      throw new BadRequestException(`No attendance on ${rule.date}: ${rule.closed}.`);
    }

    const existing = await this.prisma.teacherAttendanceRecord.findUnique({
      where: { teacherId_date: { teacherId: teacher.id, date } },
    });
    if (existing?.approvalStatus === AttendanceApprovalStatus.APPROVED) {
      throw new BadRequestException(
        'Attendance for this date is already approved. Contact the admin to change it.',
      );
    }

    // Submitted to the admin; only counted once approved.
    const pending = {
      status: AttendanceRulesService.statusFromArrival(dto.status, dto.arrivalTime, rule),
      remarks: dto.remarks,
      arrivalTime: dto.arrivalTime ?? null,
      recordedById: user.id,
      approvalStatus: AttendanceApprovalStatus.PENDING,
      reviewedById: null,
      reviewedAt: null,
      reviewNote: null,
    };
    return this.prisma.teacherAttendanceRecord.upsert({
      where: {
        teacherId_date: { teacherId: teacher.id, date },
      },
      create: { teacherId: teacher.id, date, ...pending },
      update: pending,
    });
  }

  async listTeacherSelf(user: AuthUser, from?: string, to?: string) {
    if (user.role !== Role.TEACHER) throw new ForbiddenException();
    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { userId: user.id },
    });
    if (!teacher) throw new NotFoundException('Teacher profile not found');

    const where = {
      teacherId: teacher.id,
      ...(from || to
        ? {
            date: {
              ...(from ? { gte: parseDateOnly(from) } : {}),
              ...(to ? { lte: parseDateOnly(to) } : {}),
            },
          }
        : {}),
    };
    const records = await this.prisma.teacherAttendanceRecord.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        reviewedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    const approved = records.filter(
      (r) => r.approvalStatus === AttendanceApprovalStatus.APPROVED,
    );
    return {
      total: approved.length,
      counts: this.countByStatus(approved),
      pending: records.filter(
        (r) => r.approvalStatus === AttendanceApprovalStatus.PENDING,
      ).length,
      records,
    };
  }

  private countByStatus(records: { status: string }[]) {
    return records.reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
  }

  /** Admin — teacher attendance submissions/records with filters (max 1000 rows). */
  async listTeacherAttendanceAdmin(q: ListTeacherAttendanceDto) {
    const where = {
      ...(q.approvalStatus ? { approvalStatus: q.approvalStatus } : {}),
      ...(q.teacherId ? { teacherId: q.teacherId } : {}),
      ...(q.from || q.to
        ? {
            date: {
              ...(q.from ? { gte: parseDateOnly(q.from) } : {}),
              ...(q.to ? { lte: parseDateOnly(q.to) } : {}),
            },
          }
        : {}),
    };
    const records = await this.prisma.teacherAttendanceRecord.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
      include: {
        teacher: { include: { user: { select: publicUserSelect } } },
        reviewedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return { total: records.length, counts: this.countByStatus(records), records };
  }

  /** Admin — mark many staff for one date; admin-recorded days are approved immediately. */
  async bulkMarkStaff(admin: AuthUser, dto: BulkStaffAttendanceDto) {
    const ids = dto.entries.map((e) => e.teacherId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Each teacher can only appear once');
    }
    const found = await this.prisma.teacherProfile.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw new BadRequestException('One or more teachers were not found');
    const date = parseDateOnly(dto.date);
    const now = new Date();
    // Attendance settings: closures for teachers, each teacher's own off days, arrival time → Present / Late.
    const rules = await this.rules.staffDays(dto.date, ids);
    const closed = dto.entries.filter((e) => rules[e.teacherId].closed && e.status !== 'ON_LEAVE');
    if (closed.length) {
      const reason = rules[closed[0].teacherId].closed;
      const names = await this.prisma.teacherProfile.findMany({
        where: { id: { in: closed.map((e) => e.teacherId) } },
        select: { user: { select: { firstName: true, lastName: true } } },
      });
      throw new BadRequestException(
        `No attendance on ${dto.date.slice(0, 10)} for ${names.map((n) => `${n.user.firstName} ${n.user.lastName}`.trim()).join(', ')} (${reason}).`,
      );
    }
    return this.prisma.$transaction(
      dto.entries.map((e) => {
        const data = {
          status: AttendanceRulesService.statusFromArrival(e.status, e.arrivalTime, rules[e.teacherId]),
          remarks: e.remarks?.trim() || null,
          arrivalTime: e.arrivalTime ?? null,
          recordedById: admin.id,
          approvalStatus: AttendanceApprovalStatus.APPROVED,
          reviewedById: admin.id,
          reviewedAt: now,
          reviewNote: null,
        };
        return this.prisma.teacherAttendanceRecord.upsert({
          where: { teacherId_date: { teacherId: e.teacherId, date } },
          create: { teacherId: e.teacherId, date, ...data },
          update: data,
        });
      }),
    );
  }

  /**
   * Admin — whole-day (class) attendance per student for a period: counts per status and the attendance %
   * (Present + Late ÷ days marked), with class/roll and parent phones for the WhatsApp % alert.
   */
  async dailySummary(q: AttendanceRecordsQueryDto) {
    const grouped = await this.prisma.attendanceRecord.groupBy({
      by: ['studentId', 'status'],
      where: {
        date: { gte: parseDateOnly(q.from), lte: parseDateOnly(q.to) },
        courseId: null,
        ...(q.sectionId ? { sectionId: q.sectionId } : {}),
        ...(q.studentId ? { studentId: q.studentId } : {}),
      },
      _count: { _all: true },
    });
    const ids = [...new Set(grouped.map((g) => g.studentId))];
    const students = await this.prisma.studentProfile.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        admissionNo: true,
        user: { select: { firstName: true, lastName: true } },
        enrollments: {
          where: { status: 'ACTIVE', academicYear: { isCurrent: true } },
          take: 1,
          select: { rollNumber: true, section: { select: { id: true, name: true, class: { select: { name: true } } } } },
        },
        parents: {
          where: { relation: { in: ['FATHER', 'MOTHER'] } },
          select: { relation: true, parent: { select: { user: { select: { firstName: true, lastName: true, phone: true } } } } },
        },
      },
    });
    return students
      .map((s) => {
        const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 } as Record<string, number>;
        for (const g of grouped) if (g.studentId === s.id) counts[g.status] = (counts[g.status] ?? 0) + g._count._all;
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        const e = s.enrollments[0];
        const parent = (rel: string) => {
          const u = s.parents.find((p) => p.relation === rel)?.parent.user;
          return u ? { name: [u.firstName, u.lastName].filter((x) => x && x !== '.').join(' '), phone: u.phone } : null;
        };
        return {
          studentId: s.id,
          admissionNo: s.admissionNo,
          name: `${s.user.firstName} ${s.user.lastName}`.trim(),
          rollNumber: e?.rollNumber ?? null,
          section: e ? { id: e.section.id, label: `${e.section.class.name} · ${e.section.name}` } : null,
          counts,
          total,
          percent: total ? Math.round(((counts.PRESENT + counts.LATE) / total) * 1000) / 10 : null,
          father: parent('FATHER'),
          mother: parent('MOTHER'),
        };
      })
      .sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101) || a.name.localeCompare(b.name));
  }

  /** Admin — student attendance records for the combined report (max 5000, oldest first). */
  async recordsForReport(q: AttendanceRecordsQueryDto) {
    const where = {
      date: { gte: parseDateOnly(q.from), lte: parseDateOnly(q.to) },
      ...(q.studentId ? { studentId: q.studentId } : {}),
      ...(q.courseId ? { courseId: q.courseId } : {}),
      ...(q.kind === 'DAILY' ? { courseId: null } : {}),
      ...(q.kind === 'PERIOD' ? { courseId: { not: null } } : {}),
      ...(q.sectionId
        ? { OR: [{ sectionId: q.sectionId }, { course: { sectionId: q.sectionId } }] }
        : {}),
    };
    const records = await this.prisma.attendanceRecord.findMany({
      where,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      take: 5000,
      include: {
        student: {
          select: {
            id: true,
            admissionNo: true,
            user: { select: { firstName: true, lastName: true } },
            enrollments: { select: { sectionId: true, rollNumber: true } },
          },
        },
        course: {
          select: {
            id: true,
            sectionId: true,
            subject: { select: { name: true } },
            section: { select: { id: true, name: true, class: { select: { name: true } } } },
          },
        },
        section: { select: { id: true, name: true, class: { select: { name: true } } } },
      },
    });
    return records.map((r) => {
      const section = r.section ?? r.course?.section ?? null;
      const rollNumber =
        r.student.enrollments.find((e) => e.sectionId === section?.id)?.rollNumber ?? null;
      return {
        id: r.id,
        date: r.date,
        status: r.status,
        remarks: r.remarks,
        kind: r.courseId ? 'PERIOD' : 'DAILY',
        student: {
          id: r.student.id,
          admissionNo: r.student.admissionNo,
          name: `${r.student.user.firstName} ${r.student.user.lastName}`.trim(),
          rollNumber,
        },
        section: section
          ? { id: section.id, label: `${section.class.name} · ${section.name}` }
          : null,
        course: r.course ? { id: r.course.id, subject: r.course.subject.name } : null,
      };
    });
  }

  /** Admin — approve or reject a pending teacher attendance submission. */
  async reviewTeacherAttendance(
    id: string,
    admin: AuthUser,
    dto: ReviewTeacherAttendanceDto,
  ) {
    const record = await this.prisma.teacherAttendanceRecord.findUnique({
      where: { id },
    });
    if (!record) throw new NotFoundException('Attendance record not found');
    if (record.approvalStatus !== AttendanceApprovalStatus.PENDING) {
      throw new BadRequestException('This attendance has already been reviewed');
    }
    return this.prisma.teacherAttendanceRecord.update({
      where: { id },
      data: {
        approvalStatus:
          dto.status === 'APPROVED'
            ? AttendanceApprovalStatus.APPROVED
            : AttendanceApprovalStatus.REJECTED,
        reviewedById: admin.id,
        reviewedAt: new Date(),
        reviewNote: dto.reviewNote?.trim() || null,
      },
      include: {
        teacher: { include: { user: { select: publicUserSelect } } },
        reviewedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async rosterForCourse(user: AuthUser, courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: { section: true },
    });
    if (!course) throw new NotFoundException('Course not found');

    if (user.role === Role.TEACHER) {
      const teacher = await this.prisma.teacherProfile.findUnique({
        where: { userId: user.id },
      });
      if (!teacher || course.teacherId !== teacher.id) {
        throw new ForbiddenException();
      }
    } else if (user.role !== Role.ADMIN) {
      throw new ForbiddenException();
    }

    const enrollments = await this.prisma.studentEnrollment.findMany({
      where: {
        sectionId: course.sectionId,
        academicYearId: course.academicYearId,
        status: EnrollmentStatus.ACTIVE,
      },
      include: { student: { include: { user: { select: publicUserSelect } } } },
      orderBy: { rollNumber: 'asc' },
    });

    return enrollments.map((e) => ({
      studentId: e.studentId,
      rollNumber: e.rollNumber,
      student: e.student,
    }));
  }
}
