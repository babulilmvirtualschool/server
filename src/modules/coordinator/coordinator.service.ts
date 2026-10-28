import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AttendanceApprovalStatus,
  AttendanceStatus,
  ComplaintStatus,
  EnrollmentStatus,
  LeaveRequestStatus,
  Prisma,
  Role,
  TeacherAttendanceStatus,
} from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCheckDto,
  CreateVisitDto,
  ListChecksDto,
  ListVisitsDto,
  PerformanceQueryDto,
  RangeQueryDto,
  SaveWeeklyReportDto,
  UpdateCheckDto,
  UpdateVisitDto,
  WeekQueryDto,
} from './dto/coordinator.dto';

const day = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00.000Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const name = (u?: { firstName: string; lastName: string } | null) => (u ? `${u.firstName} ${u.lastName}`.trim() : '');
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((n, x) => n + x, 0) / xs.length) * 10) / 10 : null);
/** Monday of the week of `d` (UTC). */
const monday = (d: Date) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
};
const range = (q: RangeQueryDto) => (q.from || q.to ? { ...(q.from ? { gte: day(q.from) } : {}), ...(q.to ? { lte: day(q.to) } : {}) } : undefined);

const visitInclude = {
  section: { select: { id: true, name: true, class: { select: { name: true } } } },
  teacher: { select: { id: true, employeeCode: true, user: { select: { firstName: true, lastName: true } } } },
  subject: { select: { id: true, name: true } },
  createdBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ClassVisitInclude;
const checkInclude = {
  section: { select: { id: true, name: true, class: { select: { name: true } } } },
  createdBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.CoordinatorCheckInclude;

/** PDF1 8 Coordinator module (admin portal): dashboard, class visits, discipline / classroom checks, head teacher weekly diary, reports. */
@Injectable()
export class CoordinatorService {
  constructor(private readonly prisma: PrismaService) {}

  private visitView(v: Prisma.ClassVisitGetPayload<{ include: typeof visitInclude }>) {
    return {
      ...v,
      date: ymd(v.date),
      classLabel: `${v.section.class.name} · ${v.section.name}`,
      teacherName: name(v.teacher.user),
      subjectName: v.subject?.name ?? null,
      createdByName: name(v.createdBy),
      /** Overall % = mean of punctuality % and the three star ratings as % (syllabus progress is shown on its own). */
      overall: Math.round((v.punctuality + v.lessonDelivery * 20 + v.classControl * 20 + v.studentEngagement * 20) / 4),
    };
  }

  private checkView(c: Prisma.CoordinatorCheckGetPayload<{ include: typeof checkInclude }>) {
    const items = (c.items ?? []) as { label: string; rating: string; note?: string }[];
    const score = items.length ? Math.round((items.reduce((n, i) => n + (i.rating === 'GOOD' ? 2 : i.rating === 'AVERAGE' ? 1 : 0), 0) / (items.length * 2)) * 100) : null;
    return { ...c, date: ymd(c.date), items, score, classLabel: `${c.section.class.name} · ${c.section.name}`, createdByName: name(c.createdBy) };
  }

  private async assertRefs(sectionId?: string, teacherId?: string, subjectId?: string | null) {
    if (sectionId && !(await this.prisma.section.findUnique({ where: { id: sectionId }, select: { id: true } }))) {
      throw new BadRequestException({ message: 'Class not found.', fields: { sectionId: 'Choose a class' } });
    }
    if (teacherId) {
      const t = await this.prisma.teacherProfile.findUnique({ where: { id: teacherId }, select: { user: { select: { role: true } } } });
      if (!t || t.user.role !== Role.TEACHER) throw new BadRequestException({ message: 'Teacher not found.', fields: { teacherId: 'Choose a teacher' } });
    }
    if (subjectId && !(await this.prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true } }))) {
      throw new BadRequestException({ message: 'Subject not found.', fields: { subjectId: 'Choose a subject' } });
    }
  }

  // ---------------- class visits ----------------

  async listVisits(q: ListVisitsDto) {
    const rows = await this.prisma.classVisit.findMany({
      where: { ...(range(q) ? { date: range(q) } : {}), ...(q.teacherId ? { teacherId: q.teacherId } : {}), ...(q.sectionId ? { sectionId: q.sectionId } : {}) },
      include: visitInclude,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 2000,
    });
    return rows.map((r) => this.visitView(r));
  }

  async createVisit(dto: CreateVisitDto, user: AuthUser) {
    await this.assertRefs(dto.sectionId, dto.teacherId, dto.subjectId);
    const v = await this.prisma.classVisit.create({
      data: {
        date: day(dto.date),
        sectionId: dto.sectionId,
        period: dto.period?.trim() || null,
        teacherId: dto.teacherId,
        subjectId: dto.subjectId || null,
        observation: dto.observation?.trim() || null,
        punctuality: dto.punctuality,
        lessonDelivery: dto.lessonDelivery,
        classControl: dto.classControl,
        studentEngagement: dto.studentEngagement,
        syllabusProgress: dto.syllabusProgress,
        recommendations: dto.recommendations?.trim() || null,
        createdById: user.id,
      },
      include: visitInclude,
    });
    return this.visitView(v);
  }

  async updateVisit(id: string, dto: UpdateVisitDto) {
    if (!(await this.prisma.classVisit.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Visit not found');
    await this.assertRefs(dto.sectionId, dto.teacherId, dto.subjectId);
    const v = await this.prisma.classVisit.update({
      where: { id },
      data: {
        ...(dto.date ? { date: day(dto.date) } : {}),
        ...(dto.sectionId ? { sectionId: dto.sectionId } : {}),
        ...(dto.period !== undefined ? { period: dto.period.trim() || null } : {}),
        ...(dto.teacherId ? { teacherId: dto.teacherId } : {}),
        ...(dto.subjectId !== undefined ? { subjectId: dto.subjectId || null } : {}),
        ...(dto.observation !== undefined ? { observation: dto.observation.trim() || null } : {}),
        ...(dto.punctuality !== undefined ? { punctuality: dto.punctuality } : {}),
        ...(dto.lessonDelivery !== undefined ? { lessonDelivery: dto.lessonDelivery } : {}),
        ...(dto.classControl !== undefined ? { classControl: dto.classControl } : {}),
        ...(dto.studentEngagement !== undefined ? { studentEngagement: dto.studentEngagement } : {}),
        ...(dto.syllabusProgress !== undefined ? { syllabusProgress: dto.syllabusProgress } : {}),
        ...(dto.recommendations !== undefined ? { recommendations: dto.recommendations.trim() || null } : {}),
      },
      include: visitInclude,
    });
    return this.visitView(v);
  }

  async removeVisit(id: string) {
    if (!(await this.prisma.classVisit.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Visit not found');
    await this.prisma.classVisit.delete({ where: { id } });
    return { id };
  }

  // ---------------- discipline / classroom checks ----------------

  async listChecks(q: ListChecksDto) {
    const rows = await this.prisma.coordinatorCheck.findMany({
      where: { ...(range(q) ? { date: range(q) } : {}), ...(q.kind ? { kind: q.kind } : {}), ...(q.sectionId ? { sectionId: q.sectionId } : {}) },
      include: checkInclude,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 2000,
    });
    return rows.map((r) => this.checkView(r));
  }

  async createCheck(dto: CreateCheckDto, user: AuthUser) {
    await this.assertRefs(dto.sectionId);
    if (!dto.items.length) throw new BadRequestException('Rate at least one item.');
    const c = await this.prisma.coordinatorCheck.create({
      data: {
        kind: dto.kind,
        date: day(dto.date),
        sectionId: dto.sectionId,
        items: dto.items.map((i) => ({ label: i.label.trim(), rating: i.rating, ...(i.note?.trim() ? { note: i.note.trim() } : {}) })),
        remarks: dto.remarks?.trim() || null,
        createdById: user.id,
      },
      include: checkInclude,
    });
    return this.checkView(c);
  }

  async updateCheck(id: string, dto: UpdateCheckDto) {
    if (!(await this.prisma.coordinatorCheck.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Check not found');
    await this.assertRefs(dto.sectionId);
    const c = await this.prisma.coordinatorCheck.update({
      where: { id },
      data: {
        ...(dto.kind ? { kind: dto.kind } : {}),
        ...(dto.date ? { date: day(dto.date) } : {}),
        ...(dto.sectionId ? { sectionId: dto.sectionId } : {}),
        ...(dto.items ? { items: dto.items.map((i) => ({ label: i.label.trim(), rating: i.rating, ...(i.note?.trim() ? { note: i.note.trim() } : {}) })) } : {}),
        ...(dto.remarks !== undefined ? { remarks: dto.remarks.trim() || null } : {}),
      },
      include: checkInclude,
    });
    return this.checkView(c);
  }

  async removeCheck(id: string) {
    if (!(await this.prisma.coordinatorCheck.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Check not found');
    await this.prisma.coordinatorCheck.delete({ where: { id } });
    return { id };
  }

  // ---------------- head teacher weekly diary / report ----------------

  private weeklyView(r: { weekStart: Date; entries: Prisma.JsonValue } & Record<string, unknown>) {
    return { ...r, weekStart: ymd(r.weekStart), weekEnd: ymd(new Date(r.weekStart.getTime() + 5 * 86_400_000)) };
  }

  async listWeekly(q: RangeQueryDto) {
    const rows = await this.prisma.headTeacherReport.findMany({
      where: range(q) ? { weekStart: range(q) } : {},
      include: { createdBy: { select: { firstName: true, lastName: true } } },
      orderBy: { weekStart: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({ ...this.weeklyView(r), createdByName: name(r.createdBy) }));
  }

  /** The week's report, or an empty one (Monday–Saturday diary lines) when not written yet. */
  async getWeek(q: WeekQueryDto) {
    const start = monday(day(q.weekStart));
    const r = await this.prisma.headTeacherReport.findFirst({ where: { weekStart: start } });
    if (r) return { ...this.weeklyView(r), saved: true };
    const entries = Array.from({ length: 6 }, (_, i) => ({ date: ymd(new Date(start.getTime() + i * 86_400_000)), note: '' }));
    return { ...this.weeklyView({ weekStart: start, entries, summary: null, achievements: null, concerns: null, nextWeekPlan: null }), saved: false };
  }

  async saveWeek(dto: SaveWeeklyReportDto, user: AuthUser) {
    const start = monday(day(dto.weekStart));
    const end = new Date(start.getTime() + 6 * 86_400_000);
    const entries = dto.entries
      .map((e) => ({ date: e.date.slice(0, 10), note: e.note.trim() }))
      .filter((e) => {
        const d = day(e.date);
        if (d < start || d > end) throw new BadRequestException(`${e.date} is not in this week.`);
        return true;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    const data = {
      entries,
      summary: dto.summary?.trim() || null,
      achievements: dto.achievements?.trim() || null,
      concerns: dto.concerns?.trim() || null,
      nextWeekPlan: dto.nextWeekPlan?.trim() || null,
    };
    const existing = await this.prisma.headTeacherReport.findFirst({ where: { weekStart: start }, select: { id: true } });
    const r = existing
      ? await this.prisma.headTeacherReport.update({ where: { id: existing.id }, data })
      : await this.prisma.headTeacherReport.create({ data: { ...data, weekStart: start, createdById: user.id } });
    return { ...this.weeklyView(r), saved: true };
  }

  async removeWeek(id: string) {
    if (!(await this.prisma.headTeacherReport.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Report not found');
    await this.prisma.headTeacherReport.delete({ where: { id } });
    return { id };
  }

  // ---------------- teacher performance (PDF1 8.3) ----------------

  /** Per teacher: class-visit averages, attendance (approved records) and parents' star average in the date range. */
  async teacherPerformance(q: PerformanceQueryDto) {
    const r = range(q);
    const [teachers, visits, attendance, ratings, courses] = await Promise.all([
      this.prisma.teacherProfile.findMany({
        where: { user: { role: Role.TEACHER, isActive: true }, ...(q.teacherId ? { id: q.teacherId } : {}) },
        select: { id: true, employeeCode: true, user: { select: { firstName: true, lastName: true, avatarKey: true } } },
      }),
      this.prisma.classVisit.findMany({ where: { ...(r ? { date: r } : {}), ...(q.teacherId ? { teacherId: q.teacherId } : {}) }, include: visitInclude, orderBy: { date: 'asc' } }),
      this.prisma.teacherAttendanceRecord.groupBy({
        by: ['teacherId', 'status'],
        where: { approvalStatus: AttendanceApprovalStatus.APPROVED, ...(r ? { date: r } : {}), ...(q.teacherId ? { teacherId: q.teacherId } : {}) },
        _count: { _all: true },
      }),
      this.prisma.teacherRating.groupBy({ by: ['teacherId'], _avg: { stars: true }, _count: { _all: true } }),
      this.prisma.course.findMany({
        where: { academicYear: { isCurrent: true }, ...(q.teacherId ? { teacherId: q.teacherId } : {}) },
        select: { teacherId: true, subject: { select: { name: true } }, section: { select: { name: true, class: { select: { name: true } } } } },
      }),
    ]);
    const rows = teachers.map((t) => {
      const vs = visits.filter((v) => v.teacherId === t.id).map((v) => this.visitView(v));
      const att = attendance.filter((a) => a.teacherId === t.id);
      const count = (s: TeacherAttendanceStatus) => att.find((a) => a.status === s)?._count._all ?? 0;
      const marked = att.reduce((n, a) => n + a._count._all, 0);
      const rating = ratings.find((x) => x.teacherId === t.id);
      return {
        teacherId: t.id,
        name: name(t.user),
        employeeCode: t.employeeCode,
        classes: courses.filter((c) => c.teacherId === t.id).map((c) => `${c.subject.name} (${c.section.class.name} ${c.section.name})`),
        visits: vs.length,
        punctuality: avg(vs.map((v) => v.punctuality)),
        lessonDelivery: avg(vs.map((v) => v.lessonDelivery)),
        classControl: avg(vs.map((v) => v.classControl)),
        studentEngagement: avg(vs.map((v) => v.studentEngagement)),
        syllabusProgress: vs.length ? vs[vs.length - 1].syllabusProgress : null,
        overall: avg(vs.map((v) => v.overall)),
        attendance: {
          marked,
          present: count(TeacherAttendanceStatus.PRESENT),
          late: count(TeacherAttendanceStatus.LATE),
          absent: count(TeacherAttendanceStatus.ABSENT),
          leave: count(TeacherAttendanceStatus.ON_LEAVE),
          percent: marked ? Math.round(((count(TeacherAttendanceStatus.PRESENT) + count(TeacherAttendanceStatus.LATE)) / marked) * 1000) / 10 : null,
        },
        parentRating: rating?._avg.stars != null ? Math.round(rating._avg.stars * 10) / 10 : null,
        parentRatings: rating?._count._all ?? 0,
        visitList: vs.map((v) => ({
          id: v.id,
          date: v.date,
          classLabel: v.classLabel,
          subjectName: v.subjectName,
          period: v.period,
          overall: v.overall,
          observation: v.observation,
          recommendations: v.recommendations,
        })),
      };
    });
    return rows.sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1) || a.name.localeCompare(b.name));
  }

  // ---------------- dashboard (PDF1 8.1) ----------------

  async dashboard() {
    const now = new Date();
    const today = day(ymd(now));
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const weekStart = monday(today);
    const [
      students,
      teachers,
      sections,
      visitsMonth,
      checksMonth,
      todayAttendance,
      staffToday,
      pendingStudentLeaves,
      pendingTeacherLeaves,
      openComplaints,
      pendingAdmissions,
      weekReport,
      recentVisits,
    ] = await Promise.all([
      this.prisma.studentEnrollment.count({ where: { status: EnrollmentStatus.ACTIVE, academicYear: { isCurrent: true } } }),
      this.prisma.teacherProfile.findMany({ where: { user: { role: Role.TEACHER, isActive: true } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } }),
      this.prisma.section.count({ where: { class: { academicYear: { isCurrent: true } } } }),
      this.prisma.classVisit.findMany({ where: { date: { gte: monthStart } }, include: visitInclude }),
      this.prisma.coordinatorCheck.findMany({ where: { date: { gte: monthStart } }, include: checkInclude }),
      this.prisma.attendanceRecord.groupBy({ by: ['status'], where: { date: today, courseId: null }, _count: { _all: true } }),
      this.prisma.teacherAttendanceRecord.groupBy({ by: ['status'], where: { date: today, approvalStatus: AttendanceApprovalStatus.APPROVED }, _count: { _all: true } }),
      this.prisma.studentLeaveRequest.count({ where: { status: LeaveRequestStatus.PENDING } }),
      this.prisma.teacherLeaveRequest.count({ where: { status: LeaveRequestStatus.PENDING } }),
      this.prisma.complaint.count({ where: { status: { in: [ComplaintStatus.OPEN, ComplaintStatus.IN_PROGRESS] } } }),
      this.prisma.admissionApplication.count({ where: { status: 'PENDING' } }),
      this.prisma.headTeacherReport.findFirst({ where: { weekStart }, select: { id: true } }),
      this.prisma.classVisit.findMany({ include: visitInclude, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 5 }),
    ]);
    const vs = visitsMonth.map((v) => this.visitView(v));
    const cs = checksMonth.map((c) => this.checkView(c));
    const visited = new Set(vs.map((v) => v.teacherId));
    const markedToday = todayAttendance.reduce((n, a) => n + a._count._all, 0);
    const presentToday = todayAttendance.filter((a) => a.status === AttendanceStatus.PRESENT || a.status === AttendanceStatus.LATE).reduce((n, a) => n + a._count._all, 0);
    const staffMarked = staffToday.reduce((n, a) => n + a._count._all, 0);
    const staffPresent = staffToday.filter((a) => a.status === TeacherAttendanceStatus.PRESENT || a.status === TeacherAttendanceStatus.LATE).reduce((n, a) => n + a._count._all, 0);
    return {
      month: ymd(monthStart).slice(0, 7),
      system: {
        students,
        teachers: teachers.length,
        classes: sections,
        studentAttendanceToday: { marked: markedToday, present: presentToday, percent: markedToday ? Math.round((presentToday / markedToday) * 1000) / 10 : null },
        staffAttendanceToday: { marked: staffMarked, present: staffPresent },
        pendingLeaves: pendingStudentLeaves + pendingTeacherLeaves,
        openComplaints,
        pendingAdmissions,
      },
      visits: {
        count: vs.length,
        teachersVisited: visited.size,
        notVisited: teachers.filter((t) => !visited.has(t.id)).map((t) => ({ id: t.id, name: name(t.user) })),
        punctuality: avg(vs.map((v) => v.punctuality)),
        lessonDelivery: avg(vs.map((v) => v.lessonDelivery)),
        classControl: avg(vs.map((v) => v.classControl)),
        studentEngagement: avg(vs.map((v) => v.studentEngagement)),
        syllabusProgress: avg(vs.map((v) => v.syllabusProgress)),
        overall: avg(vs.map((v) => v.overall)),
      },
      checks: {
        discipline: cs.filter((c) => c.kind === 'DISCIPLINE').length,
        classroom: cs.filter((c) => c.kind === 'CLASSROOM').length,
        averageScore: avg(cs.map((c) => c.score ?? 0)),
        poorItems: cs.flatMap((c) => c.items.filter((i) => i.rating === 'POOR').map((i) => ({ classLabel: c.classLabel, kind: c.kind, label: i.label, date: c.date }))).slice(0, 10),
      },
      weeklyReportDone: !!weekReport,
      weekStart: ymd(weekStart),
      recentVisits: recentVisits.map((v) => this.visitView(v)),
    };
  }
}
