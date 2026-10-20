import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DayOfWeek, EnrollmentStatus, Role } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceRulesService } from '../attendance/attendance-rules.service';
import {
  CreateTimetableSlotDto,
  UpdateTimetableSlotDto,
} from './dto/timetable-slot.dto';
import { AutoGenerateTimetableDto, SaveTimetablePeriodDto } from './dto/periods.dto';
import {
  courseInclude,
  DAY_ORDER,
  parseTimeToMinutes,
  timesOverlap,
} from './timetable.util';

@Injectable()
export class TimetableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: AttendanceRulesService,
  ) {}

  private slotInclude = {
    course: { include: courseInclude },
    period: true,
  };

  // ---------- period slots (PDF 9.2 "Period Slot") ----------
  listPeriods() {
    return this.prisma.timetablePeriod.findMany({ orderBy: [{ orderIndex: 'asc' }, { startTime: 'asc' }] });
  }

  private async checkPeriod(dto: SaveTimetablePeriodDto, excludeId?: string) {
    this.validateTimes(dto.startTime, dto.endTime);
    const others = await this.prisma.timetablePeriod.findMany({ where: excludeId ? { id: { not: excludeId } } : {} });
    const clash = others.find((p) => timesOverlap(dto.startTime, dto.endTime, p.startTime, p.endTime));
    if (clash) {
      throw new BadRequestException({ message: `Overlaps ${clash.name} (${clash.startTime}–${clash.endTime}).`, fields: { startTime: 'Overlaps another period' } });
    }
  }

  async createPeriod(dto: SaveTimetablePeriodDto) {
    await this.checkPeriod(dto);
    return this.prisma.timetablePeriod.create({
      data: { name: dto.name.trim(), startTime: dto.startTime, endTime: dto.endTime, isBreak: !!dto.isBreak, orderIndex: parseTimeToMinutes(dto.startTime) },
    });
  }

  /** Changing a period's time moves every timetable slot that uses it. */
  async updatePeriod(id: string, dto: SaveTimetablePeriodDto) {
    const p = await this.prisma.timetablePeriod.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Period not found');
    await this.checkPeriod(dto, id);
    if (dto.isBreak && !p.isBreak) {
      const used = await this.prisma.timetableSlot.count({ where: { periodId: id, isActive: true } });
      if (used) throw new BadRequestException(`${used} class(es) are timetabled in this period — move them before making it a break.`);
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.timetableSlot.updateMany({ where: { periodId: id }, data: { startTime: dto.startTime, endTime: dto.endTime } });
      return tx.timetablePeriod.update({
        where: { id },
        data: { name: dto.name.trim(), startTime: dto.startTime, endTime: dto.endTime, isBreak: !!dto.isBreak, orderIndex: parseTimeToMinutes(dto.startTime) },
      });
    });
  }

  /** Slots that used it keep their times. */
  async removePeriod(id: string) {
    const p = await this.prisma.timetablePeriod.findUnique({ where: { id }, select: { id: true } });
    if (!p) throw new NotFoundException('Period not found');
    await this.prisma.timetablePeriod.delete({ where: { id } });
    return { success: true as const };
  }

  private async periodTimes(periodId: string) {
    const p = await this.prisma.timetablePeriod.findUnique({ where: { id: periodId } });
    if (!p) throw new BadRequestException({ message: 'Period not found', fields: { periodId: 'Choose a period' } });
    if (p.isBreak) throw new BadRequestException({ message: `${p.name} is a break.`, fields: { periodId: 'Breaks have no classes' } });
    return p;
  }

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
    room?: string | null;
  }) {
    if (params.room) {
      const roomSlots = await this.prisma.timetableSlot.findMany({
        where: {
          isActive: true,
          dayOfWeek: params.dayOfWeek,
          room: { equals: params.room, mode: 'insensitive' },
          courseId: { not: params.courseId },
          ...(params.excludeSlotId ? { id: { not: params.excludeSlotId } } : {}),
        },
        include: { course: { include: { section: { include: { class: true } } } } },
      });
      const clash = roomSlots.find((s) => timesOverlap(params.startTime, params.endTime, s.startTime, s.endTime));
      if (clash) {
        throw new BadRequestException(
          `Room ${params.room} is already used by ${clash.course.section.class.name} ${clash.course.section.name} (${clash.startTime}–${clash.endTime})`,
        );
      }
    }
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
    if (dto.periodId) {
      const p = await this.periodTimes(dto.periodId);
      dto.startTime = p.startTime;
      dto.endTime = p.endTime;
    }
    this.validateTimes(dto.startTime, dto.endTime);
    await this.assertNoConflicts({
      courseId: dto.courseId,
      dayOfWeek: dto.dayOfWeek,
      startTime: dto.startTime,
      endTime: dto.endTime,
      room: dto.room?.trim() || null,
    });

    return this.prisma.timetableSlot.create({
      data: {
        courseId: dto.courseId,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        room: dto.room?.trim() || null,
        label: dto.label?.trim() || null,
        periodId: dto.periodId || null,
      },
      include: this.slotInclude,
    });
  }

  async update(id: string, dto: UpdateTimetableSlotDto) {
    const existing = await this.prisma.timetableSlot.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Timetable slot not found');

    if (dto.periodId) {
      const p = await this.periodTimes(dto.periodId);
      dto.startTime = p.startTime;
      dto.endTime = p.endTime;
    }
    const startTime = dto.startTime ?? existing.startTime;
    const endTime = dto.endTime ?? existing.endTime;
    const dayOfWeek = dto.dayOfWeek ?? existing.dayOfWeek;
    const room = dto.room !== undefined ? dto.room?.trim() || null : existing.room;

    this.validateTimes(startTime, endTime);
    await this.assertNoConflicts({
      courseId: existing.courseId,
      dayOfWeek,
      startTime,
      endTime,
      excludeSlotId: id,
      room,
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
        ...(dto.periodId !== undefined ? { periodId: dto.periodId || null } : {}),
      },
      include: this.slotInclude,
    });
  }

  // ---------- Auto-Generate Timetable ----------
  /**
   * Spreads each course's weekly hours over the open days and the (non-break) periods, one class per period per section,
   * without double-booking a teacher or a room (other classes' existing timetables count as busy). Preview by default;
   * `apply` replaces these classes' timetables (old slots with attendance history are deactivated, not deleted).
   */
  async autoGenerate(dto: AutoGenerateTimetableDto) {
    const periods = (await this.listPeriods()).filter((p) => !p.isBreak);
    if (!periods.length) {
      throw new BadRequestException('Add the period slots first (Timetable → Periods).');
    }
    let days = dto.days?.length ? DAY_ORDER.filter((d) => dto.days!.includes(d)) : [];
    if (!days.length) {
      const s = await this.rules.getSettings();
      const open = new Set(s.schedules.DEFAULT.filter((d) => d.open).map((d) => d.day as string));
      days = DAY_ORDER.filter((d) => open.has(d));
    }
    if (!days.length) throw new BadRequestException('No school days are open.');

    const ids = [...new Set(dto.sectionIds)];
    const sections = await this.prisma.section.findMany({
      where: { id: { in: ids } },
      include: {
        class: true,
        courses: {
          where: { isActive: true },
          include: { subject: true, teacher: { select: { id: true, user: { select: { firstName: true, lastName: true } } } } },
        },
      },
    });
    if (sections.length !== ids.length) throw new BadRequestException('One or more classes were not found.');

    // Everything outside these classes stays as it is and blocks its teachers and rooms.
    const others = await this.prisma.timetableSlot.findMany({
      where: { isActive: true, course: { isActive: true, sectionId: { notIn: ids } } },
      include: { course: { select: { teacherId: true } } },
    });
    const teacherBusy = new Map<string, [string, string][]>();
    const roomBusy = new Map<string, [string, string][]>();
    const push = (m: Map<string, [string, string][]>, k: string, s: string, e: string) => m.set(k, [...(m.get(k) ?? []), [s, e]]);
    const free = (m: Map<string, [string, string][]>, k: string, s: string, e: string) => !(m.get(k) ?? []).some(([a, b]) => timesOverlap(s, e, a, b));
    for (const o of others) {
      push(teacherBusy, `${o.course.teacherId}|${o.dayOfWeek}`, o.startTime, o.endTime);
      if (o.room) push(roomBusy, `${o.room.toLowerCase()}|${o.dayOfWeek}`, o.startTime, o.endTime);
    }

    type Planned = { sectionId: string; courseId: string; dayOfWeek: DayOfWeek; periodId: string; startTime: string; endTime: string; room: string | null };
    const plan: Planned[] = [];
    const unplaced: { sectionId: string; classLabel: string; courseId: string; subject: string; teacher: string; missing: number }[] = [];
    const warnings: string[] = [];
    const demandOf = (s: (typeof sections)[number]) => s.courses.reduce((n, c) => n + (c.weeklyHours ?? 0), 0);

    for (const section of [...sections].sort((a, b) => demandOf(b) - demandOf(a))) {
      const classLabel = `${section.class.name} · ${section.name}`;
      const room = section.room?.trim() || null;
      const capacity = days.length * periods.length;
      if (demandOf(section) > capacity) {
        warnings.push(`${classLabel}: ${demandOf(section)} weekly hours but only ${capacity} periods in the week.`);
      }
      const used = new Set<string>(); // day|periodId taken in this class
      const perDay = new Map<string, number>(); // courseId|day → periods placed
      const dayLoad = new Map<string, number>();
      const remaining = new Map(section.courses.filter((c) => (c.weeklyHours ?? 0) > 0).map((c) => [c.id, c.weeklyHours!]));
      const stuck = new Set<string>();
      let progress = true;
      while (progress) {
        progress = false;
        const order = [...remaining.entries()].filter(([id, n]) => n > 0 && !stuck.has(id)).sort((a, b) => b[1] - a[1]);
        for (const [courseId] of order) {
          const course = section.courses.find((c) => c.id === courseId)!;
          const maxPerDay = Math.ceil((course.weeklyHours ?? 0) / days.length);
          let best: { day: DayOfWeek; p: (typeof periods)[number]; score: number } | null = null;
          for (const day of days) {
            const already = perDay.get(`${courseId}|${day}`) ?? 0;
            if (already >= maxPerDay) continue;
            for (const p of periods) {
              if (used.has(`${day}|${p.id}`)) continue;
              if (!free(teacherBusy, `${course.teacherId}|${day}`, p.startTime, p.endTime)) continue;
              if (room && !free(roomBusy, `${room.toLowerCase()}|${day}`, p.startTime, p.endTime)) continue;
              // Fewer of this subject that day first, then the lighter day, then the earlier period.
              const score = already * 1000 + (dayLoad.get(day) ?? 0) * 10 + periods.indexOf(p) / 100;
              if (!best || score < best.score) best = { day, p, score };
            }
          }
          if (!best) {
            stuck.add(courseId);
            continue;
          }
          const { day, p } = best;
          used.add(`${day}|${p.id}`);
          perDay.set(`${courseId}|${day}`, (perDay.get(`${courseId}|${day}`) ?? 0) + 1);
          dayLoad.set(day, (dayLoad.get(day) ?? 0) + 1);
          push(teacherBusy, `${course.teacherId}|${day}`, p.startTime, p.endTime);
          if (room) push(roomBusy, `${room.toLowerCase()}|${day}`, p.startTime, p.endTime);
          plan.push({ sectionId: section.id, courseId, dayOfWeek: day, periodId: p.id, startTime: p.startTime, endTime: p.endTime, room });
          remaining.set(courseId, remaining.get(courseId)! - 1);
          progress = true;
        }
      }
      for (const [courseId, n] of remaining) {
        if (n <= 0) continue;
        const c = section.courses.find((x) => x.id === courseId)!;
        unplaced.push({
          sectionId: section.id,
          classLabel,
          courseId,
          subject: c.subject.name,
          teacher: `${c.teacher.user.firstName} ${c.teacher.user.lastName}`.trim(),
          missing: n,
        });
      }
      const noHours = section.courses.filter((c) => !c.weeklyHours).map((c) => c.subject.name);
      if (noHours.length) warnings.push(`${classLabel}: no weekly hours set for ${noHours.join(', ')} — not timetabled.`);
    }

    const summary = sections.map((s) => ({
      sectionId: s.id,
      classLabel: `${s.class.name} · ${s.name}`,
      placed: plan.filter((p) => p.sectionId === s.id).length,
      demand: demandOf(s),
    }));
    if (!dto.apply) return { applied: false, days, periods: periods.length, plan, unplaced, warnings, summary };

    const courseIds = sections.flatMap((s) => s.courses.map((c) => c.id));
    const result = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.timetableSlot.findMany({
          where: { courseId: { in: courseIds } },
          include: { _count: { select: { periodAttendance: true, periodLeaves: true } } },
        });
        const kept = new Set<string>();
        let created = 0;
        let updated = 0;
        for (const p of plan) {
          const same = existing.find((e) => e.courseId === p.courseId && e.dayOfWeek === p.dayOfWeek && e.startTime === p.startTime);
          if (same) {
            await tx.timetableSlot.update({ where: { id: same.id }, data: { endTime: p.endTime, periodId: p.periodId, room: p.room, isActive: true } });
            kept.add(same.id);
            updated++;
          } else {
            await tx.timetableSlot.create({ data: { courseId: p.courseId, dayOfWeek: p.dayOfWeek, startTime: p.startTime, endTime: p.endTime, periodId: p.periodId, room: p.room } });
            created++;
          }
        }
        let removed = 0;
        let deactivated = 0;
        for (const e of existing) {
          if (kept.has(e.id)) continue;
          if (e._count.periodAttendance || e._count.periodLeaves) {
            if (e.isActive) {
              await tx.timetableSlot.update({ where: { id: e.id }, data: { isActive: false } });
              deactivated++;
            }
          } else {
            await tx.timetableSlot.delete({ where: { id: e.id } });
            removed++;
          }
        }
        return { created, updated, removed, deactivated };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    return { applied: true, days, periods: periods.length, ...result, unplaced, warnings, summary };
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
