import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DayOfWeek, EnrollmentStatus, Role } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateTimetableSlotDto,
  UpdateTimetableSlotDto,
} from './dto/timetable-slot.dto';
import {
  courseInclude,
  DAY_ORDER,
  parseTimeToMinutes,
  timesOverlap,
} from './timetable.util';

@Injectable()
export class TimetableService {
  constructor(private readonly prisma: PrismaService) {}

  private slotInclude = {
    course: { include: courseInclude },
  };

  private validateTimes(startTime: string, endTime: string) {
    const start = parseTimeToMinutes(startTime);
    const end = parseTimeToMinutes(endTime);
    if (end <= start) {
      throw new BadRequestException('endTime must be after startTime');
    }
  }

  private async assertNoConflicts(params: {
    courseId: string;
    dayOfWeek: DayOfWeek;
    startTime: string;
    endTime: string;
    excludeSlotId?: string;
  }) {
    const course = await this.prisma.course.findUnique({
      where: { id: params.courseId },
      include: { section: true },
    });
    if (!course) throw new NotFoundException('Course not found');

    const sectionSlots = await this.prisma.timetableSlot.findMany({
      where: {
        isActive: true,
        course: { sectionId: course.sectionId },
        dayOfWeek: params.dayOfWeek,
        ...(params.excludeSlotId ? { id: { not: params.excludeSlotId } } : {}),
      },
      include: { course: true },
    });

    for (const slot of sectionSlots) {
      if (
        timesOverlap(
          params.startTime,
          params.endTime,
          slot.startTime,
          slot.endTime,
        )
      ) {
        throw new BadRequestException(
          `Time conflict with another class in this section (${slot.startTime}–${slot.endTime})`,
        );
      }
    }

    const teacherSlots = await this.prisma.timetableSlot.findMany({
      where: {
        isActive: true,
        course: { teacherId: course.teacherId },
        dayOfWeek: params.dayOfWeek,
        ...(params.excludeSlotId ? { id: { not: params.excludeSlotId } } : {}),
      },
    });

    for (const slot of teacherSlots) {
      if (slot.courseId === params.courseId) continue;
      if (
        timesOverlap(
          params.startTime,
          params.endTime,
          slot.startTime,
          slot.endTime,
        )
      ) {
        throw new BadRequestException(
          `Teacher already has a class at this time (${slot.startTime}–${slot.endTime})`,
        );
      }
    }
  }

  async create(dto: CreateTimetableSlotDto) {
    this.validateTimes(dto.startTime, dto.endTime);
    await this.assertNoConflicts({
      courseId: dto.courseId,
      dayOfWeek: dto.dayOfWeek,
      startTime: dto.startTime,
      endTime: dto.endTime,
    });

    return this.prisma.timetableSlot.create({
      data: {
        courseId: dto.courseId,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        room: dto.room?.trim() || null,
        label: dto.label?.trim() || null,
      },
      include: this.slotInclude,
    });
  }

  async update(id: string, dto: UpdateTimetableSlotDto) {
    const existing = await this.prisma.timetableSlot.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Timetable slot not found');

    const startTime = dto.startTime ?? existing.startTime;
    const endTime = dto.endTime ?? existing.endTime;
    const dayOfWeek = dto.dayOfWeek ?? existing.dayOfWeek;

    this.validateTimes(startTime, endTime);
    await this.assertNoConflicts({
      courseId: existing.courseId,
      dayOfWeek,
      startTime,
      endTime,
      excludeSlotId: id,
    });

    return this.prisma.timetableSlot.update({
      where: { id },
      data: {
        ...(dto.dayOfWeek !== undefined ? { dayOfWeek: dto.dayOfWeek } : {}),
        ...(dto.startTime !== undefined ? { startTime: dto.startTime } : {}),
        ...(dto.endTime !== undefined ? { endTime: dto.endTime } : {}),
        ...(dto.room !== undefined
          ? { room: dto.room?.trim() || null }
          : {}),
        ...(dto.label !== undefined
          ? { label: dto.label?.trim() || null }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: this.slotInclude,
    });
  }

  async remove(id: string) {
    try {
      return await this.prisma.timetableSlot.delete({
        where: { id },
      });
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === 'P2025') throw new NotFoundException('Timetable slot not found');
      throw e;
    }
  }

  async forSection(sectionId: string) {
    const section = await this.prisma.section.findUnique({
      where: { id: sectionId },
      include: { class: { include: { academicYear: true } } },
    });
    if (!section) throw new NotFoundException('Section not found');

    const slots = await this.prisma.timetableSlot.findMany({
      where: {
        isActive: true,
        course: { sectionId, isActive: true },
      },
      include: this.slotInclude,
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });

    return {
      section,
      days: DAY_ORDER,
      slots,
    };
  }

  async forMe(user: AuthUser) {
    if (user.role === Role.TEACHER) {
      const teacher = await this.prisma.teacherProfile.findUnique({
        where: { userId: user.id },
      });
      if (!teacher) throw new ForbiddenException('Teacher profile not found');

      const slots = await this.prisma.timetableSlot.findMany({
        where: {
          isActive: true,
          course: { teacherId: teacher.id, isActive: true },
        },
        include: this.slotInclude,
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });

      return { role: user.role, days: DAY_ORDER, slots };
    }

    if (user.role === Role.STUDENT) {
      const student = await this.prisma.studentProfile.findUnique({
        where: { userId: user.id },
        include: {
          enrollments: {
            where: { status: EnrollmentStatus.ACTIVE },
          },
        },
      });
      if (!student) throw new ForbiddenException('Student profile not found');

      const sectionIds = student.enrollments.map((e) => e.sectionId);
      const slots = await this.prisma.timetableSlot.findMany({
        where: {
          isActive: true,
          course: {
            sectionId: { in: sectionIds },
            isActive: true,
          },
        },
        include: this.slotInclude,
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });

      return { role: user.role, days: DAY_ORDER, slots };
    }

    throw new ForbiddenException('Timetable not available for this role');
  }
}
