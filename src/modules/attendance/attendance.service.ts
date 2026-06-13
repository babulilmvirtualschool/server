import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EnrollmentStatus, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { BulkMarkAttendanceDto } from './dto/attendance.dto';
import { MarkTeacherAttendanceDto } from './dto/teacher-attendance.dto';

function parseDateOnly(value: string): Date {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.$transaction(async (tx) => {
      const ops = dto.entries.map(async (entry) => {
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
        student: { include: { user: true } },
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
        student: { include: { user: true } },
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
        teacher: { include: { user: true } },
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
        student: { include: { user: true } },
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
            teacher: { include: { user: true } },
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

    return this.prisma.teacherAttendanceRecord.upsert({
      where: {
        teacherId_date: { teacherId: teacher.id, date },
      },
      create: {
        teacherId: teacher.id,
        date,
        status: dto.status,
        remarks: dto.remarks,
        recordedById: user.id,
      },
      update: {
        status: dto.status,
        remarks: dto.remarks,
        recordedById: user.id,
      },
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
    });
    const counts = records.reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    return { total: records.length, counts, records };
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
      include: { student: { include: { user: true } } },
      orderBy: { rollNumber: 'asc' },
    });

    return enrollments.map((e) => ({
      studentId: e.studentId,
      rollNumber: e.rollNumber,
      student: e.student,
    }));
  }
}
