import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceStatus,
  EnrollmentStatus,
  LeaveRequestStatus,
  Role,
  TeacherAttendanceStatus,
} from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  getSkipTake,
  paginate,
} from '../../common/pagination/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStudentLeaveDto } from './dto/create-student-leave.dto';
import { CreateTeacherLeaveDto } from './dto/create-teacher-leave.dto';
import { ListLeavesDto } from './dto/list-leaves.dto';
import { UpdateLeaveStatusDto } from './dto/update-leave-status.dto';

function parseDateOnly(value: string): Date {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function eachDateInclusive(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

@Injectable()
export class LeaveService {
  constructor(private readonly prisma: PrismaService) {}

  private async teacherForUser(userId: string) {
    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { userId },
      include: { user: true },
    });
    if (!teacher) throw new ForbiddenException('Teacher profile not found');
    return teacher;
  }

  private async studentForUser(userId: string) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId },
      include: { user: true },
    });
    if (!student) throw new ForbiddenException('Student profile not found');
    return student;
  }

  private validateLeaveDates(startDate: string, endDate: string) {
    const start = parseDateOnly(startDate);
    const end = parseDateOnly(endDate);
    if (end < start) {
      throw new BadRequestException('endDate must be on or after startDate');
    }
    return { start, end };
  }

  // -------- Teacher leave --------

  async createTeacherLeave(user: AuthUser, dto: CreateTeacherLeaveDto) {
    if (user.role !== Role.TEACHER) throw new ForbiddenException();
    const teacher = await this.teacherForUser(user.id);
    const { start, end } = this.validateLeaveDates(dto.startDate, dto.endDate);
    return this.prisma.teacherLeaveRequest.create({
      data: {
        teacherId: teacher.id,
        type: dto.type,
        startDate: start,
        endDate: end,
        reason: dto.reason.trim(),
      },
      include: {
        teacher: { include: { user: true } },
      },
    });
  }

  async listMyTeacherLeaves(user: AuthUser, query: ListLeavesDto) {
    if (user.role !== Role.TEACHER) throw new ForbiddenException();
    const teacher = await this.teacherForUser(user.id);
    const { skip, take, page, limit } = getSkipTake(query);
    const where = {
      teacherId: teacher.id,
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.teacherLeaveRequest.count({ where }),
      this.prisma.teacherLeaveRequest.findMany({
        where,
        skip,
        take,
        orderBy: { requestedAt: 'desc' },
        include: {
          reviewedBy: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
    ]);
    return paginate(data, total, page, limit);
  }

  async listTeacherLeavesAdmin(query: ListLeavesDto) {
    const { skip, take, page, limit } = getSkipTake(query);
    const where = query.status ? { status: query.status } : {};
    const [total, data] = await this.prisma.$transaction([
      this.prisma.teacherLeaveRequest.count({ where }),
      this.prisma.teacherLeaveRequest.findMany({
        where,
        skip,
        take,
        orderBy: { requestedAt: 'desc' },
        include: {
          teacher: { include: { user: true } },
          reviewedBy: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
    ]);
    return paginate(data, total, page, limit);
  }

  async updateTeacherLeaveStatus(
    id: string,
    admin: AuthUser,
    dto: UpdateLeaveStatusDto,
  ) {
    const leave = await this.prisma.teacherLeaveRequest.findUnique({
      where: { id },
      include: { teacher: true },
    });
    if (!leave) throw new NotFoundException('Leave request not found');
    if (leave.status !== LeaveRequestStatus.PENDING) {
      throw new BadRequestException('Leave request has already been reviewed');
    }

    const now = new Date();
    const updated = await this.prisma.teacherLeaveRequest.update({
      where: { id },
      data: {
        status:
          dto.status === 'APPROVED'
            ? LeaveRequestStatus.APPROVED
            : LeaveRequestStatus.REJECTED,
        reviewedById: admin.id,
        reviewedAt: now,
        reviewNote: dto.reviewNote?.trim() || null,
      },
      include: {
        teacher: { include: { user: true } },
        reviewedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    if (dto.status === 'APPROVED') {
      await this.syncTeacherLeaveAttendance(updated, admin.id);
    }

    return updated;
  }

  private async syncTeacherLeaveAttendance(
    leave: { teacherId: string; startDate: Date; endDate: Date },
    recordedById: string,
  ) {
    const dates = eachDateInclusive(leave.startDate, leave.endDate);
    await this.prisma.$transaction(
      dates.map((date) =>
        this.prisma.teacherAttendanceRecord.upsert({
          where: {
            teacherId_date: { teacherId: leave.teacherId, date },
          },
          create: {
            teacherId: leave.teacherId,
            date,
            status: TeacherAttendanceStatus.ON_LEAVE,
            recordedById,
            remarks: 'Approved leave',
          },
          update: {
            status: TeacherAttendanceStatus.ON_LEAVE,
            recordedById,
            remarks: 'Approved leave',
          },
        }),
      ),
    );
  }

  // -------- Student leave --------

  async createStudentLeave(user: AuthUser, dto: CreateStudentLeaveDto) {
    if (user.role !== Role.STUDENT) throw new ForbiddenException();
    const student = await this.studentForUser(user.id);
    const { start, end } = this.validateLeaveDates(dto.startDate, dto.endDate);
    return this.prisma.studentLeaveRequest.create({
      data: {
        studentId: student.id,
        type: dto.type,
        startDate: start,
        endDate: end,
        reason: dto.reason.trim(),
        requestedById: user.id,
      },
      include: {
        student: { include: { user: true } },
      },
    });
  }

  async listMyStudentLeaves(user: AuthUser, query: ListLeavesDto) {
    if (user.role !== Role.STUDENT) throw new ForbiddenException();
    const student = await this.studentForUser(user.id);
    const { skip, take, page, limit } = getSkipTake(query);
    const where = {
      studentId: student.id,
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.studentLeaveRequest.count({ where }),
      this.prisma.studentLeaveRequest.findMany({
        where,
        skip,
        take,
        orderBy: { startDate: 'desc' },
        include: {
          reviewedBy: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
    ]);
    return paginate(data, total, page, limit);
  }

  async listStudentLeavesAdmin(query: ListLeavesDto) {
    const { skip, take, page, limit } = getSkipTake(query);
    const where = query.status ? { status: query.status } : {};
    const [total, data] = await this.prisma.$transaction([
      this.prisma.studentLeaveRequest.count({ where }),
      this.prisma.studentLeaveRequest.findMany({
        where,
        skip,
        take,
        orderBy: { startDate: 'desc' },
        include: {
          student: { include: { user: true } },
          requestedBy: {
            select: { id: true, firstName: true, lastName: true, role: true },
          },
          reviewedBy: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
    ]);
    return paginate(data, total, page, limit);
  }

  async updateStudentLeaveStatus(
    id: string,
    admin: AuthUser,
    dto: UpdateLeaveStatusDto,
  ) {
    const leave = await this.prisma.studentLeaveRequest.findUnique({
      where: { id },
      include: { student: true },
    });
    if (!leave) throw new NotFoundException('Leave request not found');
    if (leave.status !== LeaveRequestStatus.PENDING) {
      throw new BadRequestException('Leave request has already been reviewed');
    }

    const now = new Date();
    const updated = await this.prisma.studentLeaveRequest.update({
      where: { id },
      data: {
        status:
          dto.status === 'APPROVED'
            ? LeaveRequestStatus.APPROVED
            : LeaveRequestStatus.REJECTED,
        reviewedById: admin.id,
        reviewedAt: now,
        reviewNote: dto.reviewNote?.trim() || null,
      },
      include: {
        student: { include: { user: true } },
        requestedBy: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
        reviewedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    if (dto.status === 'APPROVED') {
      await this.syncStudentLeaveAttendance(updated, admin.id);
    }

    return updated;
  }

  private async syncStudentLeaveAttendance(
    leave: { studentId: string; startDate: Date; endDate: Date },
    markedById: string,
  ) {
    const enrollments = await this.prisma.studentEnrollment.findMany({
      where: {
        studentId: leave.studentId,
        status: EnrollmentStatus.ACTIVE,
      },
    });
    if (!enrollments.length) return;

    const dates = eachDateInclusive(leave.startDate, leave.endDate);

    for (const enrollment of enrollments) {
      const courses = await this.prisma.course.findMany({
        where: {
          sectionId: enrollment.sectionId,
          academicYearId: enrollment.academicYearId,
        },
        select: { id: true },
      });

      for (const date of dates) {
        const existingHomeroom = await this.prisma.attendanceRecord.findFirst({
          where: {
            date,
            studentId: leave.studentId,
            sectionId: enrollment.sectionId,
            courseId: null,
          },
        });
        if (existingHomeroom) {
          await this.prisma.attendanceRecord.update({
            where: { id: existingHomeroom.id },
            data: {
              status: AttendanceStatus.EXCUSED,
              remarks: 'Approved leave',
              markedById,
            },
          });
        } else {
          await this.prisma.attendanceRecord.create({
            data: {
              date,
              studentId: leave.studentId,
              sectionId: enrollment.sectionId,
              courseId: null,
              status: AttendanceStatus.EXCUSED,
              remarks: 'Approved leave',
              markedById,
            },
          });
        }

        for (const course of courses) {
          const existing = await this.prisma.attendanceRecord.findFirst({
            where: {
              date,
              studentId: leave.studentId,
              courseId: course.id,
            },
          });
          if (existing) {
            await this.prisma.attendanceRecord.update({
              where: { id: existing.id },
              data: {
                status: AttendanceStatus.EXCUSED,
                remarks: 'Approved leave',
                markedById,
                sectionId: enrollment.sectionId,
              },
            });
          } else {
            await this.prisma.attendanceRecord.create({
              data: {
                date,
                studentId: leave.studentId,
                courseId: course.id,
                sectionId: enrollment.sectionId,
                status: AttendanceStatus.EXCUSED,
                remarks: 'Approved leave',
                markedById,
              },
            });
          }
        }
      }
    }
  }
}
