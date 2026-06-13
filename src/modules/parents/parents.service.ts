import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class ParentsService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureParentOf(user: AuthUser, studentId: string) {
    if (user.role !== Role.PARENT) throw new ForbiddenException();
    const parent = await this.prisma.parentProfile.findUnique({
      where: { userId: user.id },
    });
    if (!parent) throw new ForbiddenException();
    const link = await this.prisma.parentStudentLink.findFirst({
      where: { parentId: parent.id, studentId },
    });
    if (!link) throw new ForbiddenException('Not a parent of this student');
    return parent;
  }

  async myChildren(user: AuthUser) {
    if (user.role !== Role.PARENT) throw new ForbiddenException();
    const parent = await this.prisma.parentProfile.findUnique({
      where: { userId: user.id },
      include: {
        children: {
          include: {
            student: {
              include: {
                user: true,
                enrollments: {
                  include: {
                    section: { include: { class: true } },
                    academicYear: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!parent) throw new NotFoundException();
    return parent.children;
  }

  async childAttendance(
    user: AuthUser,
    studentId: string,
    from?: string,
    to?: string,
  ) {
    await this.ensureParentOf(user, studentId);
    const where = {
      studentId,
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
      include: {
        course: { include: { subject: true, section: { include: { class: true } } } },
        section: true,
        markedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { date: 'desc' },
    });
    const counts = records.reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    const student = await this.prisma.studentProfile.findUnique({
      where: { id: studentId },
      include: { user: true },
    });
    return {
      student,
      total: records.length,
      counts,
      records,
    };
  }

  async childResults(user: AuthUser, studentId: string) {
    await this.ensureParentOf(user, studentId);
    return this.prisma.examResult.findMany({
      where: { studentId, publishedAt: { not: null } },
      include: {
        examPaper: {
          include: {
            exam: true,
            course: { include: { subject: true } },
          },
        },
      },
    });
  }

  async childInvoices(user: AuthUser, studentId: string) {
    await this.ensureParentOf(user, studentId);
    return this.prisma.feeInvoice.findMany({
      where: { studentId },
      include: { payments: true },
      orderBy: { dueDate: 'desc' },
    });
  }
}
