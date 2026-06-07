import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { BulkMarkAttendanceDto } from './dto/attendance.dto';

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
      include: { student: { include: { user: true } } },
    });
  }

  async listForCourseDate(courseId: string, date: string) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return this.prisma.attendanceRecord.findMany({
      where: { courseId, date: d },
      include: { student: { include: { user: true } } },
    });
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
}
