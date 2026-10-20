import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceApprovalStatus,
  DayOfWeek,
  LeaveRequestStatus,
  Prisma,
  Role,
  TeacherAttendanceStatus,
} from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceRulesService } from '../attendance/attendance-rules.service';
import {
  BulkPeriodAttendanceDto,
  CreatePeriodLeaveDto,
  PeriodLeavesQueryDto,
  PeriodReportQueryDto,
  RangeQueryDto,
  ReviewPeriodLeaveDto,
} from './dto/periods.dto';
import { timesOverlap } from './timetable.util';

const WEEKDAYS: (DayOfWeek | null)[] = [null, 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const utcDay = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00.000Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const weekdayOf = (d: string) => WEEKDAYS[utcDay(d).getUTCDay()];
const todayYmd = () => ymd(new Date());
const name = (u?: { firstName: string; lastName: string } | null) => (u ? `${u.firstName} ${u.lastName}`.trim() : '');
const ABSENT_LIKE: TeacherAttendanceStatus[] = [TeacherAttendanceStatus.ABSENT, TeacherAttendanceStatus.ON_LEAVE];

const teacherSelect = { id: true, employeeCode: true, user: { select: { firstName: true, lastName: true } } } as const;
const slotInclude = {
  period: { select: { id: true, name: true } },
  course: {
    select: {
      id: true,
      teacherId: true,
      subject: { select: { name: true } },
      section: { select: { id: true, name: true, class: { select: { name: true } } } },
      teacher: { select: teacherSelect },
    },
  },
} as const;
type SlotRow = Prisma.TimetableSlotGetPayload<{ include: typeof slotInclude }>;

/**
 * Period-wise teacher attendance (client 11/12 Oct): marked by the admin per timetable period, filled automatically from the
 * teacher's day attendance; a teacher can ask for leave from one period; the admin approves it with a substitute (who then sees
 * the period) or rejects it with a reason, and can change that decision later.
 */
@Injectable()
export class PeriodAttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: AttendanceRulesService,
  ) {}

  private slotView(s: SlotRow) {
    return {
      slotId: s.id,
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      room: s.room,
      period: s.period?.name ?? null,
      periodId: s.period?.id ?? null,
      sectionId: s.course.section.id,
      classLabel: `${s.course.section.class.name} · ${s.course.section.name}`,
      subject: s.course.subject.name,
      teacher: { id: s.course.teacherId, name: name(s.course.teacher.user), employeeCode: s.course.teacher.employeeCode },
    };
  }

  /** Active slots of current-year courses on a weekday. */
  private daySlots(day: DayOfWeek, extra: Prisma.TimetableSlotWhereInput = {}) {
    return this.prisma.timetableSlot.findMany({
      where: { isActive: true, dayOfWeek: day, course: { isActive: true, academicYear: { isCurrent: true } }, ...extra },
      include: slotInclude,
      orderBy: [{ startTime: 'asc' }],
    });
  }

  /** The teacher's approved day record → the period status it implies (Leave/Absent stay, Present/Late → Present). */
  private static fromDay(status?: TeacherAttendanceStatus | null) {
    if (!status) return null;
    return status === TeacherAttendanceStatus.LATE ? TeacherAttendanceStatus.PRESENT : status;
  }

  // ---------- admin board for one date ----------
  async board(date: string) {
    const day = weekdayOf(date);
    if (!day) return { date: date.slice(0, 10), weekday: 'SUNDAY', rows: [], teachers: [] };
    const d = utcDay(date);
    const slots = await this.daySlots(day);
    const slotIds = slots.map((s) => s.id);
    const allTeachers = await this.prisma.teacherProfile.findMany({
      where: { user: { role: Role.TEACHER, isActive: true } },
      select: teacherSelect,
    });
    const teacherIds = allTeachers.map((t) => t.id);
    const [dayRules, dayRecords, saved, leaves] = await Promise.all([
      this.rules.staffDays(date, teacherIds),
      this.prisma.teacherAttendanceRecord.findMany({
        where: { date: d, teacherId: { in: teacherIds }, approvalStatus: AttendanceApprovalStatus.APPROVED },
        select: { teacherId: true, status: true },
      }),
      this.prisma.periodAttendance.findMany({
        where: { date: d, slotId: { in: slotIds } },
        include: { substitute: { select: teacherSelect } },
      }),
      this.prisma.periodLeaveRequest.findMany({
        where: { date: d, slotId: { in: slotIds }, status: { in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED] } },
        orderBy: { createdAt: 'desc' },
        include: { substitute: { select: teacherSelect } },
      }),
    ]);
    const dayStatus = new Map(dayRecords.map((r) => [r.teacherId, r.status]));

    const rows = slots.map((s) => {
      const tId = s.course.teacherId;
      const rec = saved.find((x) => x.slotId === s.id);
      const leave = leaves.find((x) => x.slotId === s.id) ?? null;
      const auto = PeriodAttendanceService.fromDay(dayStatus.get(tId));
      const status = rec?.status ?? auto;
      // Who could take this period: free teachers who are not absent / on leave / off that day.
      const freeTeachers = allTeachers
        .filter((t) => {
          if (t.id === tId) return false;
          if (dayRules[t.id]?.closed) return false;
          if (ABSENT_LIKE.includes(dayStatus.get(t.id) as TeacherAttendanceStatus)) return false;
          if (slots.some((o) => o.course.teacherId === t.id && timesOverlap(s.startTime, s.endTime, o.startTime, o.endTime))) return false;
          return !saved.some(
            (x) =>
              x.substituteTeacherId === t.id &&
              x.slotId !== s.id &&
              slots.some((o) => o.id === x.slotId && timesOverlap(s.startTime, s.endTime, o.startTime, o.endTime)),
          );
        })
        .map((t) => ({ id: t.id, name: name(t.user), employeeCode: t.employeeCode }));
      return {
        ...this.slotView(s),
        closed: dayRules[tId]?.closed ?? null,
        dayStatus: dayStatus.get(tId) ?? null,
        autoStatus: auto,
        status,
        source: rec ? 'MARKED' : auto ? 'AUTO' : null,
        substitute: rec?.substitute ? { id: rec.substitute.id, name: name(rec.substitute.user) } : null,
        remarks: rec?.remarks ?? null,
        needsSubstitute: !!status && ABSENT_LIKE.includes(status) && !rec?.substituteTeacherId,
        leave: leave
          ? {
              id: leave.id,
              status: leave.status,
              reason: leave.reason,
              substitute: leave.substitute ? { id: leave.substitute.id, name: name(leave.substitute.user) } : null,
            }
          : null,
        freeTeachers,
      };
    });
    return { date: date.slice(0, 10), weekday: day, rows };
  }

  /** A substitute must be another active teacher who is free in that period and present that day. */
  private async assertSubstitute(subId: string, slot: SlotRow, date: string, taken: { subId: string; start: string; end: string }[] = []) {
    if (subId === slot.course.teacherId) {
      throw new BadRequestException({ message: 'The substitute must be another teacher.', fields: { substituteTeacherId: 'Same teacher' } });
    }
    const sub = await this.prisma.teacherProfile.findFirst({
      where: { id: subId, user: { role: Role.TEACHER, isActive: true } },
      select: teacherSelect,
    });
    if (!sub) throw new BadRequestException({ message: 'Substitute teacher not found.', fields: { substituteTeacherId: 'Choose a teacher' } });
    const who = name(sub.user);
    const d = utcDay(date);
    const rule = (await this.rules.staffDays(date, [subId]))[subId];
    if (rule?.closed) throw new BadRequestException(`${who} is not working on ${date.slice(0, 10)} (${rule.closed}).`);
    const dayRec = await this.prisma.teacherAttendanceRecord.findFirst({
      where: { teacherId: subId, date: d, approvalStatus: AttendanceApprovalStatus.APPROVED, status: { in: ABSENT_LIKE } },
    });
    if (dayRec) throw new BadRequestException(`${who} is ${dayRec.status === 'ON_LEAVE' ? 'on leave' : 'absent'} on ${date.slice(0, 10)}.`);
    const own = await this.daySlots(slot.dayOfWeek, { course: { isActive: true, academicYear: { isCurrent: true }, teacherId: subId } });
    const busy = own.find((o) => timesOverlap(slot.startTime, slot.endTime, o.startTime, o.endTime));
    if (busy) throw new BadRequestException(`${who} teaches ${busy.course.section.class.name} ${busy.course.section.name} at ${busy.startTime}.`);
    const subs = await this.prisma.periodAttendance.findMany({
      where: { date: d, substituteTeacherId: subId, slotId: { not: slot.id } },
      include: { slot: { select: { startTime: true, endTime: true } } },
    });
    if (
      subs.some((x) => timesOverlap(slot.startTime, slot.endTime, x.slot.startTime, x.slot.endTime)) ||
      taken.some((x) => x.subId === subId && timesOverlap(slot.startTime, slot.endTime, x.start, x.end))
    ) {
      throw new BadRequestException(`${who} is already a substitute in another class at ${slot.startTime}.`);
    }
  }

  private async slotFor(slotId: string, date: string) {
    const slot = await this.prisma.timetableSlot.findUnique({ where: { id: slotId }, include: slotInclude });
    if (!slot) throw new NotFoundException('Timetable period not found');
    if (slot.dayOfWeek !== weekdayOf(date)) {
      throw new BadRequestException(`${slot.course.subject.name} (${slot.startTime}) is on ${slot.dayOfWeek.toLowerCase()}, not on ${date.slice(0, 10)}.`);
    }
    return slot;
  }

  /** Admin saves the marked periods of a date (status, substitute for Absent / Leave, remarks). */
  async saveBoard(admin: AuthUser, dto: BulkPeriodAttendanceDto) {
    const ids = dto.entries.map((e) => e.slotId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Each period can only appear once.');
    const d = utcDay(dto.date);
    const taken: { subId: string; start: string; end: string }[] = [];
    const prepared: { slot: SlotRow; e: (typeof dto.entries)[number] }[] = [];
    for (const e of dto.entries) {
      const slot = await this.slotFor(e.slotId, dto.date);
      const rule = (await this.rules.staffDays(dto.date, [slot.course.teacherId]))[slot.course.teacherId];
      if (rule?.closed && e.status !== TeacherAttendanceStatus.ON_LEAVE) {
        throw new BadRequestException(`No classes for ${name(slot.course.teacher.user)} on ${dto.date.slice(0, 10)} (${rule.closed}).`);
      }
      if (e.substituteTeacherId) {
        if (!ABSENT_LIKE.includes(e.status)) {
          throw new BadRequestException('A substitute is only for a teacher who is absent or on leave.');
        }
        await this.assertSubstitute(e.substituteTeacherId, slot, dto.date, taken);
        taken.push({ subId: e.substituteTeacherId, start: slot.startTime, end: slot.endTime });
      }
      prepared.push({ slot, e });
    }
    await this.prisma.$transaction(
      prepared.map(({ slot, e }) => {
        const data = {
          teacherId: slot.course.teacherId,
          status: e.status,
          substituteTeacherId: e.substituteTeacherId || null,
          remarks: e.remarks?.trim() || null,
          recordedById: admin.id,
        };
        return this.prisma.periodAttendance.upsert({
          where: { slotId_date: { slotId: slot.id, date: d } },
          create: { slotId: slot.id, date: d, ...data },
          update: data,
        });
      }),
    );
    return this.board(dto.date);
  }

  // ---------- period leave requests ----------
  async requestLeave(user: AuthUser, dto: CreatePeriodLeaveDto) {
    const slot = await this.slotFor(dto.slotId, dto.date);
    const me = await this.prisma.teacherProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!me || slot.course.teacherId !== me.id) throw new ForbiddenException('This is not your period.');
    if (dto.date.slice(0, 10) < todayYmd()) {
      throw new BadRequestException({ message: 'Choose today or a later date.', fields: { date: 'Date has passed' } });
    }
    const rule = (await this.rules.staffDays(dto.date, [me.id]))[me.id];
    if (rule?.closed) throw new BadRequestException(`No classes on ${dto.date.slice(0, 10)} (${rule.closed}).`);
    const open = await this.prisma.periodLeaveRequest.findFirst({
      where: { slotId: slot.id, date: utcDay(dto.date), status: { in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED] } },
    });
    if (open) throw new ConflictException('You already asked for leave from this period.');
    return this.prisma.periodLeaveRequest.create({
      data: { teacherId: me.id, slotId: slot.id, date: utcDay(dto.date), reason: dto.reason.trim() },
    });
  }

  private leaveInclude = {
    slot: { include: slotInclude },
    teacher: { select: teacherSelect },
    substitute: { select: teacherSelect },
    reviewedBy: { select: { firstName: true, lastName: true } },
  } as const;

  private leaveView(l: Prisma.PeriodLeaveRequestGetPayload<{ include: PeriodAttendanceService['leaveInclude'] }>) {
    return {
      ...this.slotView(l.slot),
      id: l.id,
      date: ymd(l.date),
      reason: l.reason,
      status: l.status,
      reviewNote: l.reviewNote,
      reviewedAt: l.reviewedAt,
      reviewedBy: name(l.reviewedBy),
      createdAt: l.createdAt,
      teacher: { id: l.teacher.id, name: name(l.teacher.user), employeeCode: l.teacher.employeeCode },
      substitute: l.substitute ? { id: l.substitute.id, name: name(l.substitute.user) } : null,
    };
  }

  async myLeaves(user: AuthUser) {
    const rows = await this.prisma.periodLeaveRequest.findMany({
      where: { teacher: { userId: user.id } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      include: this.leaveInclude,
    });
    return rows.map((l) => this.leaveView(l));
  }

  async listLeaves(q: PeriodLeavesQueryDto) {
    const rows = await this.prisma.periodLeaveRequest.findMany({
      where: q.status ? { status: q.status } : { status: { not: LeaveRequestStatus.CANCELLED } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 300,
      include: this.leaveInclude,
    });
    return rows.map((l) => this.leaveView(l));
  }

  /** Approve with a substitute (period marked Leave + substitute) or reject with a reason; the admin may change it again later. */
  async reviewLeave(admin: AuthUser, id: string, dto: ReviewPeriodLeaveDto) {
    const leave = await this.prisma.periodLeaveRequest.findUnique({ where: { id } });
    if (!leave) throw new NotFoundException('Leave request not found');
    const date = ymd(leave.date);
    const slot = await this.slotFor(leave.slotId, date);
    if (dto.status === 'APPROVED') {
      if (!dto.substituteTeacherId) {
        throw new BadRequestException({ message: 'Choose a substitute teacher, or reject the request with a reason.', fields: { substituteTeacherId: 'Required to approve' } });
      }
      await this.assertSubstitute(dto.substituteTeacherId, slot, date);
    } else if (!dto.reviewNote?.trim()) {
      throw new BadRequestException({ message: 'Write the reason for rejecting.', fields: { reviewNote: 'Required to reject' } });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.periodLeaveRequest.update({
        where: { id },
        data: {
          status: dto.status,
          substituteTeacherId: dto.status === 'APPROVED' ? dto.substituteTeacherId! : null,
          reviewNote: dto.reviewNote?.trim() || null,
          reviewedById: admin.id,
          reviewedAt: new Date(),
        },
      });
      const key = { slotId_date: { slotId: slot.id, date: leave.date } };
      if (dto.status === 'APPROVED') {
        const data = {
          teacherId: slot.course.teacherId,
          status: TeacherAttendanceStatus.ON_LEAVE,
          substituteTeacherId: dto.substituteTeacherId!,
          remarks: leave.reason,
          recordedById: admin.id,
        };
        await tx.periodAttendance.upsert({ where: key, create: { slotId: slot.id, date: leave.date, ...data }, update: data });
      } else if (leave.status === LeaveRequestStatus.APPROVED) {
        // Rejected after being approved: the teacher takes the period again.
        await tx.periodAttendance.deleteMany({ where: { slotId: slot.id, date: leave.date, status: TeacherAttendanceStatus.ON_LEAVE } });
      }
    });
    const updated = await this.prisma.periodLeaveRequest.findUniqueOrThrow({ where: { id }, include: this.leaveInclude });
    return this.leaveView(updated);
  }

  /** Teacher — periods they cover as a substitute (default today … 14 days ahead). */
  async mySubstitutions(user: AuthUser, q: RangeQueryDto) {
    const from = q.from ? utcDay(q.from) : utcDay(todayYmd());
    const to = q.to ? utcDay(q.to) : new Date(from.getTime() + 14 * 86_400_000);
    const rows = await this.prisma.periodAttendance.findMany({
      where: { substitute: { userId: user.id }, date: { gte: from, lte: to } },
      orderBy: [{ date: 'asc' }],
      include: { slot: { include: slotInclude } },
    });
    return rows
      .map((r) => ({ id: r.id, date: ymd(r.date), status: r.status, remarks: r.remarks, ...this.slotView(r.slot) }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  }

  // ---------- report ----------
  /** Every period in the range with its status (marked, or from the day attendance), filterable by teacher, class and period. */
  async report(q: PeriodReportQueryDto) {
    const from = utcDay(q.from);
    const to = utcDay(q.to);
    if (to < from) throw new BadRequestException({ message: 'The end date is before the start date.', fields: { to: 'Before the start date' } });
    if ((to.getTime() - from.getTime()) / 86_400_000 > 62) throw new BadRequestException('Choose at most 2 months.');
    const courseWhere: Prisma.CourseWhereInput = {
      ...(q.teacherId ? { teacherId: q.teacherId } : {}),
      ...(q.sectionId ? { sectionId: q.sectionId } : {}),
    };
    const slotFilter: Prisma.TimetableSlotWhereInput = { ...(q.periodId ? { periodId: q.periodId } : {}), course: courseWhere };
    const [active, saved] = await Promise.all([
      this.prisma.timetableSlot.findMany({
        where: { ...slotFilter, isActive: true, course: { ...courseWhere, isActive: true, academicYear: { isCurrent: true } } },
        include: slotInclude,
      }),
      this.prisma.periodAttendance.findMany({
        where: { date: { gte: from, lte: to }, slot: slotFilter },
        include: { slot: { include: slotInclude }, substitute: { select: teacherSelect } },
      }),
    ]);
    const teacherIds = [...new Set([...active.map((s) => s.course.teacherId), ...saved.map((r) => r.teacherId)])];
    const dayRecords = await this.prisma.teacherAttendanceRecord.findMany({
      where: { date: { gte: from, lte: to }, teacherId: { in: teacherIds }, approvalStatus: AttendanceApprovalStatus.APPROVED },
      select: { teacherId: true, date: true, status: true },
    });
    const dayKey = (t: string, d: string) => `${t}|${d}`;
    const dayMap = new Map(dayRecords.map((r) => [dayKey(r.teacherId, ymd(r.date)), r.status]));
    const savedMap = new Map(saved.map((r) => [`${r.slotId}|${ymd(r.date)}`, r]));

    const rows: Record<string, unknown>[] = [];
    for (let t = from.getTime(); t <= to.getTime() && rows.length < 5000; t += 86_400_000) {
      const date = ymd(new Date(t));
      const day = weekdayOf(date);
      if (!day) continue;
      const slots = active.filter((s) => s.dayOfWeek === day);
      const closed = await this.rules.staffDays(date, [...new Set(slots.map((s) => s.course.teacherId))]);
      const seen = new Set<string>();
      for (const s of slots) {
        if (closed[s.course.teacherId]?.closed) continue;
        const rec = savedMap.get(`${s.id}|${date}`);
        seen.add(s.id);
        const auto = PeriodAttendanceService.fromDay(dayMap.get(dayKey(s.course.teacherId, date)));
        rows.push({
          date,
          ...this.slotView(s),
          status: rec?.status ?? auto,
          source: rec ? 'MARKED' : auto ? 'AUTO' : null,
          substitute: rec?.substitute ? name(rec.substitute.user) : null,
          remarks: rec?.remarks ?? null,
        });
      }
      // Marked periods of slots that are no longer in the timetable.
      for (const rec of saved.filter((r) => ymd(r.date) === date && !seen.has(r.slotId))) {
        rows.push({
          date,
          ...this.slotView(rec.slot),
          status: rec.status,
          source: 'MARKED',
          substitute: rec.substitute ? name(rec.substitute.user) : null,
          remarks: rec.remarks,
        });
      }
    }
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.startTime).localeCompare(String(b.startTime)));
    const totals = new Map<string, { teacherId: string; name: string; PRESENT: number; ABSENT: number; LATE: number; ON_LEAVE: number; NOT_MARKED: number; covered: number }>();
    for (const r of rows as { teacher: { id: string; name: string }; status: TeacherAttendanceStatus | null; substitute: string | null }[]) {
      const t = totals.get(r.teacher.id) ?? { teacherId: r.teacher.id, name: r.teacher.name, PRESENT: 0, ABSENT: 0, LATE: 0, ON_LEAVE: 0, NOT_MARKED: 0, covered: 0 };
      if (r.status) t[r.status]++;
      else t.NOT_MARKED++;
      if (r.substitute) t.covered++;
      totals.set(r.teacher.id, t);
    }
    return { from: ymd(from), to: ymd(to), rows, totals: [...totals.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  }
}
