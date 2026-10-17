import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceMode, Prisma, SchoolShift } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ClosuresQueryDto,
  CreateClosureDto,
  DayTimingDto,
  SaveAttendanceSettingsDto,
  SaveSectionShiftsDto,
  SaveStaffTimingDto,
  WEEKDAYS,
  Weekday,
} from './dto/attendance-settings.dto';

type Day = { day: Weekday; open: boolean; start: string; end: string };
type Schedules = Record<'DEFAULT' | 'MORNING' | 'EVENING', Day[]>;
export type ClosureGroup = 'STUDENT' | 'TEACHER' | 'STAFF';

const week = (start: string, end: string): Day[] =>
  WEEKDAYS.map((day) => ({ day, open: day !== 'SUNDAY', start, end }));

/** Used until the school saves its own settings: Monday–Saturday, Sunday off, 25 minutes late threshold. */
export const DEFAULT_SETTINGS = {
  mode: AttendanceMode.DEFAULT,
  lateThresholdMinutes: 25,
  schedules: { DEFAULT: week('08:00', '14:00'), MORNING: week('08:00', '13:00'), EVENING: week('14:00', '19:00') } as Schedules,
};

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
/** "2026-10-17" → "SATURDAY" (calendar date, timezone-independent). */
export const weekdayOf = (date: string) => WEEKDAYS[(new Date(`${date.slice(0, 10)}T00:00:00Z`).getUTCDay() + 6) % 7];
const utcDay = (date: string) => new Date(`${date.slice(0, 10)}T00:00:00.000Z`);

export type DayRule = {
  date: string;
  weekday: Weekday;
  /** Why no attendance is taken on this day (closed weekday or a closure), else null. */
  closed: string | null;
  start: string | null;
  end: string | null;
  lateThresholdMinutes: number;
  /** Arrivals after this time are Late. */
  lateAfter: string | null;
};

/** Attendance settings, per-staff timings, school closures — and the rules derived from them (closed days, automatic Late). */
@Injectable()
export class AttendanceRulesService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- settings ----------
  async getSettings() {
    const s = await this.prisma.attendanceSettings.findFirst();
    if (!s) return { ...DEFAULT_SETTINGS, saved: false };
    return { mode: s.mode, lateThresholdMinutes: s.lateThresholdMinutes, schedules: s.schedules as unknown as Schedules, saved: true };
  }

  async saveSettings(dto: SaveAttendanceSettingsDto) {
    const schedules = {
      DEFAULT: this.checkWeek(dto.schedules.DEFAULT, 'Daily timing'),
      MORNING: this.checkWeek(dto.schedules.MORNING, 'Morning shift'),
      EVENING: this.checkWeek(dto.schedules.EVENING, 'Evening shift'),
    } as unknown as Prisma.InputJsonValue;
    const data = { mode: dto.mode, lateThresholdMinutes: dto.lateThresholdMinutes, schedules };
    const existing = await this.prisma.attendanceSettings.findFirst({ select: { id: true } });
    if (existing) await this.prisma.attendanceSettings.update({ where: { id: existing.id }, data });
    else await this.prisma.attendanceSettings.create({ data });
    return this.getSettings();
  }

  /** Seven days, each once, start before end on open days. */
  private checkWeek(days: DayTimingDto[], label: string): Day[] {
    if (new Set(days.map((d) => d.day)).size !== 7) throw new BadRequestException(`${label}: give each weekday once.`);
    for (const d of days) {
      if (d.open && toMinutes(d.start) >= toMinutes(d.end)) {
        throw new BadRequestException(`${label}: ${d.day.charAt(0) + d.day.slice(1).toLowerCase()} must start before it ends.`);
      }
    }
    return WEEKDAYS.map((day) => {
      const d = days.find((x) => x.day === day)!;
      return { day, open: d.open, start: d.start, end: d.end };
    });
  }

  // ---------- class shifts ----------
  async listSectionShifts() {
    const sections = await this.prisma.section.findMany({
      where: { class: { academicYear: { isCurrent: true } } },
      select: { id: true, name: true, shift: true, class: { select: { name: true, level: true } } },
    });
    return sections
      .sort((a, b) => a.class.level - b.class.level || a.class.name.localeCompare(b.class.name) || a.name.localeCompare(b.name))
      .map((s) => ({ sectionId: s.id, label: `${s.class.name} · ${s.name}`, shift: s.shift }));
  }

  async saveSectionShifts(dto: SaveSectionShiftsDto) {
    const ids = dto.sections.map((s) => s.sectionId);
    const found = await this.prisma.section.count({ where: { id: { in: ids } } });
    if (found !== new Set(ids).size) throw new BadRequestException('One or more classes were not found.');
    await this.prisma.$transaction(
      dto.sections.map((s) => this.prisma.section.update({ where: { id: s.sectionId }, data: { shift: s.shift ?? null } })),
    );
    return this.listSectionShifts();
  }

  // ---------- per-staff timings ----------
  async listStaffTimings() {
    const rows = await this.prisma.staffTiming.findMany({
      include: { teacher: { select: { id: true, employeeCode: true, user: { select: { firstName: true, lastName: true, avatarKey: true } } } } },
    });
    return rows
      .map((r) => ({
        teacherId: r.teacherId,
        name: `${r.teacher.user.firstName} ${r.teacher.user.lastName}`.trim(),
        employeeCode: r.teacher.employeeCode,
        avatarKey: r.teacher.user.avatarKey,
        shift: r.shift,
        lateThresholdMinutes: r.lateThresholdMinutes,
        days: r.days as unknown as Day[],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveStaffTiming(teacherId: string, dto: SaveStaffTimingDto) {
    const t = await this.prisma.teacherProfile.findUnique({ where: { id: teacherId }, select: { id: true } });
    if (!t) throw new NotFoundException('Teacher not found');
    const data = {
      shift: dto.shift ?? null,
      lateThresholdMinutes: dto.lateThresholdMinutes ?? null,
      days: this.checkWeek(dto.days, 'Staff timing') as unknown as Prisma.InputJsonValue,
    };
    await this.prisma.staffTiming.upsert({ where: { teacherId }, create: { teacherId, ...data }, update: data });
    return (await this.listStaffTimings()).find((r) => r.teacherId === teacherId);
  }

  async removeStaffTiming(teacherId: string) {
    const r = await this.prisma.staffTiming.findUnique({ where: { teacherId }, select: { id: true } });
    if (!r) throw new NotFoundException('No timing saved for this teacher');
    await this.prisma.staffTiming.delete({ where: { teacherId } });
    return { success: true as const };
  }

  // ---------- closures ----------
  listClosures(q: ClosuresQueryDto) {
    return this.prisma.schoolClosure.findMany({
      where: {
        ...(q.to ? { fromDate: { lte: utcDay(q.to) } } : {}),
        ...(q.from ? { toDate: { gte: utcDay(q.from) } } : {}),
      },
      orderBy: { fromDate: 'desc' },
    });
  }

  createClosure(dto: CreateClosureDto) {
    if (dto.toDate.slice(0, 10) < dto.fromDate.slice(0, 10)) {
      throw new BadRequestException({ message: 'The end date is before the start date.', fields: { toDate: 'Must be on or after the start date' } });
    }
    return this.prisma.schoolClosure.create({
      data: {
        name: dto.name.trim(),
        appliesTo: dto.appliesTo,
        fromDate: utcDay(dto.fromDate),
        toDate: utcDay(dto.toDate),
        note: dto.note?.trim() || null,
      },
    });
  }

  async removeClosure(id: string) {
    const c = await this.prisma.schoolClosure.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw new NotFoundException('Closure not found');
    await this.prisma.schoolClosure.delete({ where: { id } });
    return { success: true as const };
  }

  // ---------- rules ----------
  private async closureOn(date: string, group: ClosureGroup) {
    const d = utcDay(date);
    return this.prisma.schoolClosure.findFirst({
      where: { fromDate: { lte: d }, toDate: { gte: d }, appliesTo: { has: group } },
      orderBy: { fromDate: 'asc' },
    });
  }

  private rule(date: string, day: Day | undefined, threshold: number, closure: { name: string } | null): DayRule {
    const weekday = weekdayOf(date);
    const closed = closure ? closure.name : day && !day.open ? `${weekday.charAt(0) + weekday.slice(1).toLowerCase()} is a closed day` : null;
    const start = day?.start ?? null;
    return {
      date: date.slice(0, 10),
      weekday,
      closed,
      start,
      end: day?.end ?? null,
      lateThresholdMinutes: threshold,
      lateAfter: start ? toHHMM(toMinutes(start) + threshold) : null,
    };
  }

  /** The day's rule for a class: its shift's timings in Shifts mode (else the default timings), closures for students. */
  async studentDay(date: string, sectionId?: string | null): Promise<DayRule> {
    const s = await this.getSettings();
    let shift: SchoolShift | null = null;
    if (s.mode === AttendanceMode.SHIFTS && sectionId) {
      shift = (await this.prisma.section.findUnique({ where: { id: sectionId }, select: { shift: true } }))?.shift ?? null;
    }
    const day = s.schedules[shift ?? 'DEFAULT'].find((d) => d.day === weekdayOf(date));
    return this.rule(date, day, s.lateThresholdMinutes, await this.closureOn(date, 'STUDENT'));
  }

  /** The day's rule per teacher: their own timing if saved, else their shift / the school timings; closures for teachers. */
  async staffDays(date: string, teacherIds: string[]): Promise<Record<string, DayRule>> {
    const s = await this.getSettings();
    const closure = await this.closureOn(date, 'TEACHER');
    const timings = await this.prisma.staffTiming.findMany({ where: { teacherId: { in: teacherIds } } });
    const weekday = weekdayOf(date);
    const out: Record<string, DayRule> = {};
    for (const id of teacherIds) {
      const t = timings.find((x) => x.teacherId === id);
      const days = t ? (t.days as unknown as Day[]) : s.schedules.DEFAULT;
      out[id] = this.rule(date, days.find((d) => d.day === weekday), t?.lateThresholdMinutes ?? s.lateThresholdMinutes, closure);
    }
    return out;
  }

  /** staffDays for every teacher of the school. */
  async allStaffDays(date: string) {
    const ids = (await this.prisma.teacherProfile.findMany({ select: { id: true } })).map((t) => t.id);
    return this.staffDays(date, ids);
  }

  /** Present / Late from an arrival time ("HH:mm"); other statuses are kept as marked. */
  static statusFromArrival<T extends string>(status: T, arrivalTime: string | undefined | null, rule: DayRule): T {
    if (!arrivalTime || !rule.lateAfter || (status !== 'PRESENT' && status !== 'LATE')) return status;
    return (toMinutes(arrivalTime) > toMinutes(rule.lateAfter) ? 'LATE' : 'PRESENT') as T;
  }
}
