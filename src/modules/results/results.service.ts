import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AttemptStatus, EnrollmentStatus, MediaPurpose, Prisma, ResultTermStatus, Role } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { ownUploads } from '../../common/utils/own-uploads';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AddCategoryDto,
  CategorySource,
  CreateGradeScaleDto,
  CreateResultTermDto,
  ReportCardSettingsDto,
  ResultCategoryDto,
  ResultsQueryDto,
  SaveSheetDto,
  UpdateGradeScaleDto,
  UpdateResultTermDto,
  UpdateSummaryDto,
} from './dto/results.dto';

export type Band = { letter: string; from: number; to: number; points?: number; remarks?: string };
export type Category = { key: string; name: string; source: CategorySource; weight: number; examId?: string };
export type Cell = { obtained: number | null; max: number; manual?: boolean };
type Scale = { passPercent: number; bands: Band[] } | null;

const AUTO: CategorySource[] = ['EXAM', 'QUIZ', 'ASSIGNMENT', 'HOMEWORK'];
const round = (n: number) => Math.round(n * 100) / 100;
const day = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00.000Z`);
const name = (u?: { firstName: string; lastName: string } | null) => (u ? `${u.firstName} ${u.lastName}`.trim() : '');

/** Grade band of a percentage: the band with the highest "from" not above it (gaps between bands fall to the lower one). */
export function gradeFor(scale: Scale, pct: number | null) {
  if (pct == null || !scale) return null;
  const band = [...scale.bands].sort((a, b) => b.from - a.from).find((b) => round(pct) >= b.from);
  return band ?? null;
}

/** Competition ranking (1, 1, 3) by percent, highest first. */
function rank<T extends { percent: number | null }>(rows: T[], set: (row: T, pos: number) => void) {
  const sorted = rows.filter((r) => r.percent != null).sort((a, b) => b.percent! - a.percent!);
  let prev: { pct: number; pos: number } | null = null;
  sorted.forEach((r, i) => {
    const pct = round(r.percent!);
    const pos = prev && prev.pct === pct ? prev.pos : i + 1;
    set(r, pos);
    prev = { pct, pos };
  });
}

/** PDF1 13.1–13.4 results: grading scales, result terms (categories + weightage), marks entry, compile / lock / publish, report-card data. */
@Injectable()
export class ResultsService {
  constructor(private readonly prisma: PrismaService) {}

  // ================= grading scales (13.1) =================
  private checkBands(bands: Band[]) {
    const sorted = [...bands].sort((a, b) => a.from - b.from);
    for (const b of sorted) if (b.from > b.to) throw new BadRequestException({ message: `${b.letter}: "from" is above "to".`, fields: { bands: 'From must be ≤ To' } });
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].from <= sorted[i - 1].to) throw new BadRequestException({ message: `${sorted[i - 1].letter} and ${sorted[i].letter} overlap.`, fields: { bands: 'Ranges overlap' } });
    }
    const letters = bands.map((b) => b.letter.trim().toUpperCase());
    if (new Set(letters).size !== letters.length) throw new BadRequestException({ message: 'Each grade letter can be used once.', fields: { bands: 'Duplicate letter' } });
    return sorted.reverse().map((b) => ({ letter: b.letter.trim(), from: b.from, to: b.to, ...(b.points != null ? { points: b.points } : {}), ...(b.remarks?.trim() ? { remarks: b.remarks.trim() } : {}) }));
  }

  listScales(academicYearId?: string) {
    return this.prisma.gradeScale.findMany({
      where: academicYearId ? { OR: [{ academicYearId }, { academicYearId: null }] } : {},
      include: { academicYear: { select: { id: true, name: true } }, _count: { select: { resultTerms: true } } },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async createScale(dto: CreateGradeScaleDto) {
    const bands = this.checkBands(dto.bands);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.gradeScale.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      return tx.gradeScale.create({ data: { name: dto.name.trim(), academicYearId: dto.academicYearId || null, passPercent: dto.passPercent, bands, isDefault: !!dto.isDefault } });
    });
  }

  async updateScale(id: string, dto: UpdateGradeScaleDto) {
    const s = await this.prisma.gradeScale.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Grading scale not found');
    const locked = await this.prisma.resultTerm.count({ where: { gradeScaleId: id, status: ResultTermStatus.LOCKED } });
    if (locked && (dto.bands || dto.passPercent !== undefined)) throw new ConflictException('A locked result uses this scale — reopen it before changing the grades.');
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.gradeScale.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
      return tx.gradeScale.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.academicYearId !== undefined ? { academicYearId: dto.academicYearId || null } : {}),
          ...(dto.passPercent !== undefined ? { passPercent: dto.passPercent } : {}),
          ...(dto.bands ? { bands: this.checkBands(dto.bands) } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
        },
      });
    });
  }

  async deleteScale(id: string) {
    const used = await this.prisma.resultTerm.count({ where: { gradeScaleId: id } });
    if (used) throw new ConflictException(`${used} result(s) use this grading scale. Choose another scale for them first.`);
    await this.prisma.gradeScale.delete({ where: { id } });
    return { id };
  }

  // ================= access =================
  private async teacherId(user: AuthUser) {
    const t = await this.prisma.teacherProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!t) throw new ForbiddenException();
    return t.id;
  }

  /** Admin: every course. Teacher: own course only. */
  private async assertCourse(user: AuthUser, courseId: string) {
    const c = await this.prisma.course.findUnique({ where: { id: courseId }, include: { teacher: { select: { userId: true } }, subject: true, section: { include: { class: true } } } });
    if (!c) throw new NotFoundException('Class subject not found');
    if (user.role !== Role.ADMIN && c.teacher.userId !== user.id) throw new ForbiddenException('You can only enter marks for your own subjects.');
    return c;
  }

  /** Admin: null (all). Teacher: sections they teach a subject in or are class teacher of. */
  private async sectionIdsFor(user: AuthUser): Promise<string[] | null> {
    if (user.role === Role.ADMIN) return null;
    const tid = await this.teacherId(user);
    const [courses, homeroom] = await Promise.all([
      this.prisma.course.findMany({ where: { teacherId: tid }, select: { sectionId: true } }),
      this.prisma.section.findMany({ where: { classTeacherId: tid }, select: { id: true } }),
    ]);
    return [...new Set([...courses.map((c) => c.sectionId), ...homeroom.map((s) => s.id)])];
  }

  // ================= result terms (13.2) =================
  private async checkCategories(categories: ResultCategoryDto[], academicYearId: string): Promise<Category[]> {
    const keys = categories.map((c) => c.key);
    if (new Set(keys).size !== keys.length) throw new BadRequestException({ message: 'Each category needs its own key.', fields: { categories: 'Duplicate key' } });
    if (!categories.some((c) => c.weight > 0)) throw new BadRequestException({ message: 'Give at least one category a weightage.', fields: { categories: 'All weights are 0' } });
    for (const c of categories) {
      if (c.source === 'EXAM') {
        if (!c.examId) throw new BadRequestException({ message: `${c.name}: choose the exam session.`, fields: { categories: 'Exam missing' } });
        const exam = await this.prisma.exam.findUnique({ where: { id: c.examId } });
        if (!exam || exam.academicYearId !== academicYearId) throw new BadRequestException({ message: `${c.name}: the exam is not in this academic year.`, fields: { categories: 'Wrong exam' } });
      }
    }
    return categories.map((c) => ({ key: c.key, name: c.name.trim(), source: c.source, weight: c.weight, ...(c.source === 'EXAM' ? { examId: c.examId } : {}) }));
  }

  listTerms(academicYearId?: string) {
    return this.prisma.resultTerm.findMany({
      where: academicYearId ? { academicYearId } : {},
      include: { gradeScale: { select: { id: true, name: true, passPercent: true } }, academicYear: { select: { id: true, name: true } }, _count: { select: { summaries: true, entries: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTerm(id: string) {
    const t = await this.prisma.resultTerm.findUnique({ where: { id }, include: { gradeScale: true, academicYear: true } });
    if (!t) throw new NotFoundException('Result not found');
    return t;
  }

  async createTerm(dto: CreateResultTermDto) {
    const year = await this.prisma.academicYear.findUnique({ where: { id: dto.academicYearId } });
    if (!year) throw new NotFoundException('Academic year not found');
    const categories = await this.checkCategories(dto.categories, year.id);
    const scaleId = dto.gradeScaleId || (await this.prisma.gradeScale.findFirst({ where: { isDefault: true }, select: { id: true } }))?.id || null;
    return this.prisma.resultTerm.create({
      data: {
        name: dto.name.trim(),
        academicYearId: year.id,
        gradeScaleId: scaleId,
        categories: categories as unknown as Prisma.InputJsonValue,
        fromDate: dto.fromDate ? day(dto.fromDate) : null,
        toDate: dto.toDate ? day(dto.toDate) : null,
        includeAttendance: !!dto.includeAttendance,
        attendanceWeight: dto.includeAttendance ? (dto.attendanceWeight ?? 0) : 0,
      },
    });
  }

  private assertOpen(t: { status: ResultTermStatus }) {
    if (t.status === ResultTermStatus.LOCKED) throw new ConflictException('This result is locked. Reopen it for correction first.');
  }

  async updateTerm(id: string, dto: UpdateResultTermDto) {
    const t = await this.getTerm(id);
    this.assertOpen(t);
    const categories = dto.categories ? await this.checkCategories(dto.categories, t.academicYearId) : undefined;
    return this.prisma.resultTerm.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.gradeScaleId !== undefined ? { gradeScaleId: dto.gradeScaleId || null } : {}),
        ...(categories ? { categories: categories as unknown as Prisma.InputJsonValue } : {}),
        ...(dto.fromDate !== undefined ? { fromDate: dto.fromDate ? day(dto.fromDate) : null } : {}),
        ...(dto.toDate !== undefined ? { toDate: dto.toDate ? day(dto.toDate) : null } : {}),
        ...(dto.includeAttendance !== undefined ? { includeAttendance: dto.includeAttendance } : {}),
        ...(dto.includeAttendance === false ? { attendanceWeight: 0 } : dto.attendanceWeight !== undefined ? { attendanceWeight: dto.attendanceWeight } : {}),
      },
    });
  }

  /** PDF2 Teacher 11: teachers add a category (marks entered by hand) while the result is open. */
  async addCategory(id: string, dto: AddCategoryDto) {
    const t = await this.getTerm(id);
    this.assertOpen(t);
    const cats = t.categories as unknown as Category[];
    const base = dto.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'category';
    let key = base;
    for (let i = 2; cats.some((c) => c.key === key); i++) key = `${base}_${i}`;
    const next = [...cats, { key, name: dto.name.trim(), source: 'MANUAL' as const, weight: dto.weight }];
    return this.prisma.resultTerm.update({ where: { id }, data: { categories: next as unknown as Prisma.InputJsonValue } });
  }

  async deleteTerm(id: string) {
    const t = await this.getTerm(id);
    this.assertOpen(t);
    await this.prisma.resultTerm.delete({ where: { id } });
    return { id };
  }

  // ================= automatic marks =================
  private window(t: { fromDate: Date | null; toDate: Date | null; academicYear: { startDate: Date; endDate: Date } }) {
    const from = t.fromDate ?? t.academicYear.startDate;
    const to = new Date((t.toDate ?? t.academicYear.endDate).getTime() + 86_399_999);
    const now = new Date();
    return { from, to, until: to < now ? to : now };
  }

  /** Marks the portal already has for one class subject, per category: exam papers, quizzes, assignments, diary homework stars. */
  private async autoCells(term: Awaited<ReturnType<ResultsService['getTerm']>>, courseId: string, studentIds: string[]) {
    const cats = (term.categories as unknown as Category[]).filter((c) => AUTO.includes(c.source));
    const { from, until } = this.window(term);
    const out = new Map<string, Record<string, Cell>>(studentIds.map((s) => [s, {}]));
    for (const c of cats) {
      if (c.source === 'EXAM') {
        const paper = await this.prisma.examPaper.findFirst({ where: { examId: c.examId, courseId }, include: { results: { where: { studentId: { in: studentIds } } }, quiz: { select: { id: true, totalMarks: true } } } });
        if (!paper) continue;
        const attempts = paper.quiz
          ? await this.prisma.quizAttempt.findMany({ where: { quizId: paper.quiz.id, studentId: { in: studentIds }, status: { not: AttemptStatus.IN_PROGRESS }, score: { not: null } }, select: { studentId: true, score: true } })
          : [];
        for (const s of studentIds) {
          const r = paper.results.find((x) => x.studentId === s);
          const best = attempts.filter((a) => a.studentId === s).reduce((m, a) => Math.max(m, a.score ?? 0), -1);
          const fromQuiz = best >= 0 && paper.quiz?.totalMarks ? round((best / paper.quiz.totalMarks) * paper.maxMarks) : null;
          out.get(s)![c.key] = { obtained: r ? r.marksObtained : fromQuiz, max: paper.maxMarks };
        }
      } else if (c.source === 'QUIZ') {
        const quizzes = await this.prisma.quiz.findMany({
          where: { courseId, isExam: false, isPublished: true, totalMarks: { gt: 0 }, startAt: { gte: from }, endAt: { lte: until } },
          select: { id: true, totalMarks: true, attempts: { where: { studentId: { in: studentIds }, status: { not: AttemptStatus.IN_PROGRESS }, score: { not: null } }, select: { studentId: true, score: true } } },
        });
        if (!quizzes.length) continue;
        const max = quizzes.reduce((m, q) => m + q.totalMarks, 0);
        for (const s of studentIds) {
          const got = quizzes.reduce((m, q) => m + Math.max(0, ...q.attempts.filter((a) => a.studentId === s).map((a) => a.score ?? 0)), 0);
          out.get(s)![c.key] = { obtained: round(got), max };
        }
      } else if (c.source === 'ASSIGNMENT') {
        const items = await this.prisma.assignment.findMany({
          where: { courseId, isPublished: true, maxMarks: { gt: 0 }, dueDate: { gte: from, lte: until } },
          select: { maxMarks: true, submissions: { where: { studentId: { in: studentIds } }, select: { studentId: true, grade: { select: { marksObtained: true } } } } },
        });
        if (!items.length) continue;
        const max = items.reduce((m, a) => m + a.maxMarks, 0);
        for (const s of studentIds) {
          const got = items.reduce((m, a) => m + (a.submissions.find((x) => x.studentId === s)?.grade?.marksObtained ?? 0), 0);
          out.get(s)![c.key] = { obtained: round(got), max };
        }
      } else if (c.source === 'HOMEWORK') {
        // Diary homework: stars out of 5 per homework given (a checked homework without stars counts as done = 5).
        const entries = await this.prisma.diaryEntry.findMany({
          where: { courseId, date: { gte: from, lte: until }, submissions: { some: {} } },
          select: { submissions: { where: { studentId: { in: studentIds } }, select: { studentId: true, stars: true, checked: true } } },
        });
        if (!entries.length) continue;
        for (const s of studentIds) {
          const got = entries.reduce((m, e) => {
            const sub = e.submissions.find((x) => x.studentId === s);
            return m + (sub ? (sub.stars ?? (sub.checked ? 5 : 0)) : 0);
          }, 0);
          out.get(s)![c.key] = { obtained: got, max: entries.length * 5 };
        }
      }
    }
    return out;
  }

  // ================= computing =================
  /** Subject % = Σ weight × obtained / max ÷ Σ weight (categories with marks in this subject), + grace. A missing mark counts 0. */
  private computeCourse(cats: Category[], rows: { marks: Record<string, Cell>; grace: number }[], scale: Scale) {
    const counted = cats.filter((c) => c.weight > 0 && rows.some((r) => r.marks[c.key] && r.marks[c.key].obtained != null && r.marks[c.key].max > 0));
    const maxOf = (key: string) => rows.map((r) => r.marks[key]).find((x) => x && x.max > 0)?.max ?? 100;
    return rows.map((r) => {
      if (!counted.length) return { percent: null, grade: null, gradePoint: null, passed: null };
      const wsum = counted.reduce((m, c) => m + c.weight, 0);
      const got = counted.reduce((m, c) => {
        const cell = r.marks[c.key];
        const max = cell?.max > 0 ? cell.max : maxOf(c.key);
        return m + c.weight * Math.min(1, (cell?.obtained ?? 0) / max);
      }, 0);
      const percent = round(Math.min(100, (got / wsum) * 100 + (r.grace || 0)));
      const band = gradeFor(scale, percent);
      return { percent, grade: band?.letter ?? null, gradePoint: band?.points ?? null, passed: scale ? percent >= scale.passPercent : null };
    });
  }

  private cleanMarks(cats: Category[], raw: Record<string, unknown> | null | undefined): Record<string, Cell> {
    const out: Record<string, Cell> = {};
    for (const c of cats) {
      const v = (raw ?? {})[c.key] as Partial<Cell> | null | undefined;
      if (!v || typeof v !== 'object') continue;
      const max = Number(v.max);
      const obtained = v.obtained == null || (v.obtained as unknown) === '' ? null : Number(v.obtained);
      if (!(max > 0) || (obtained != null && (!Number.isFinite(obtained) || obtained < 0))) continue;
      if (obtained != null && obtained > max) throw new BadRequestException(`${c.name}: marks can't be more than ${max}.`);
      out[c.key] = { obtained, max, ...(v.manual || c.source === 'MANUAL' ? { manual: true } : {}) };
    }
    return out;
  }

  /** Recomputes the entries of the given courses (optionally pulling fresh automatic marks first) and every student summary. */
  private async rebuild(termId: string, { refreshAuto, courseIds }: { refreshAuto: boolean; courseIds?: string[] }) {
    const term = await this.getTerm(termId);
    const cats = term.categories as unknown as Category[];
    const scale: Scale = term.gradeScale ? { passPercent: term.gradeScale.passPercent, bands: term.gradeScale.bands as unknown as Band[] } : null;
    const courses = await this.prisma.course.findMany({
      where: { academicYearId: term.academicYearId, isActive: true, ...(courseIds ? { id: { in: courseIds } } : {}) },
      select: { id: true, sectionId: true },
    });
    for (const course of courses) {
      const enrolled = (await this.prisma.studentEnrollment.findMany({ where: { sectionId: course.sectionId, academicYearId: term.academicYearId, status: EnrollmentStatus.ACTIVE }, select: { studentId: true } })).map((e) => e.studentId);
      const existing = await this.prisma.resultEntry.findMany({ where: { termId, courseId: course.id } });
      const auto = refreshAuto ? await this.autoCells(term, course.id, enrolled) : null;
      const rows = enrolled.map((studentId) => {
        const e = existing.find((x) => x.studentId === studentId);
        const marks: Record<string, Cell> = { ...((e?.marks as unknown as Record<string, Cell>) ?? {}) };
        for (const k of Object.keys(marks)) if (!cats.some((c) => c.key === k)) delete marks[k];
        if (auto) {
          for (const c of cats.filter((x) => AUTO.includes(x.source))) {
            if (marks[c.key]?.manual) continue;
            const v = auto.get(studentId)?.[c.key];
            if (v) marks[c.key] = v;
            else delete marks[c.key];
          }
        }
        return { studentId, marks, grace: e?.grace ?? 0, remarks: e?.remarks ?? null };
      });
      const computed = this.computeCourse(cats, rows, scale);
      await this.prisma.$transaction(
        rows.map((r, i) =>
          this.prisma.resultEntry.upsert({
            where: { termId_courseId_studentId: { termId, courseId: course.id, studentId: r.studentId } },
            update: { marks: r.marks as unknown as Prisma.InputJsonValue, ...computed[i] },
            create: { termId, courseId: course.id, studentId: r.studentId, marks: r.marks as unknown as Prisma.InputJsonValue, grace: r.grace, ...computed[i] },
          }),
        ),
      );
    }
    await this.rebuildSummaries(term, scale);
  }

  /** Overall %, grade, GPA, pass / fail, attendance and positions (section, class, school) of every student. */
  private async rebuildSummaries(term: Awaited<ReturnType<ResultsService['getTerm']>>, scale: Scale) {
    const enrollments = await this.prisma.studentEnrollment.findMany({
      where: { academicYearId: term.academicYearId, status: EnrollmentStatus.ACTIVE },
      select: { studentId: true, sectionId: true, section: { select: { classId: true } } },
    });
    const entries = await this.prisma.resultEntry.findMany({ where: { termId: term.id, percent: { not: null } }, select: { studentId: true, percent: true, gradePoint: true, passed: true } });
    const { from, until } = this.window(term);
    const att = await this.prisma.attendanceRecord.groupBy({
      by: ['studentId', 'status'],
      where: { courseId: null, date: { gte: from, lte: until }, studentId: { in: enrollments.map((e) => e.studentId) } },
      _count: { _all: true },
    });
    const rows = enrollments.map((en) => {
      const mine = entries.filter((e) => e.studentId === en.studentId);
      const a = att.filter((x) => x.studentId === en.studentId);
      const cnt = (s: string) => a.filter((x) => x.status === s).reduce((m, x) => m + x._count._all, 0);
      const days = a.reduce((m, x) => m + x._count._all, 0);
      const present = cnt('PRESENT') + cnt('LATE');
      const attendancePercent = days ? round((present / days) * 100) : null;
      let percent = mine.length ? mine.reduce((m, e) => m + e.percent!, 0) / mine.length : null;
      if (percent != null && term.includeAttendance && term.attendanceWeight > 0 && attendancePercent != null) {
        percent = percent * (1 - term.attendanceWeight / 100) + attendancePercent * (term.attendanceWeight / 100);
      }
      percent = percent == null ? null : round(percent);
      const band = gradeFor(scale, percent);
      const gps = mine.map((e) => e.gradePoint);
      return {
        studentId: en.studentId,
        sectionId: en.sectionId,
        classId: en.section.classId,
        subjects: mine.length,
        percent,
        grade: band?.letter ?? null,
        gradePoint: gps.length && gps.every((g) => g != null) ? round(gps.reduce((m, g) => m + g!, 0) / gps.length) : (band?.points ?? null),
        passed: percent == null || !scale ? null : mine.every((e) => e.passed !== false) && percent >= scale.passPercent,
        attendanceDays: days || null,
        attendancePresent: days ? present : null,
        attendanceAbsent: days ? cnt('ABSENT') : null,
        attendancePercent,
        sectionPosition: null as number | null,
        classPosition: null as number | null,
        schoolPosition: null as number | null,
      };
    });
    rank(rows, (r, p) => {
      r.schoolPosition = p;
    });
    for (const key of ['sectionId', 'classId'] as const) {
      const groups = new Map<string, typeof rows>();
      for (const r of rows) groups.set(r[key], [...(groups.get(r[key]) ?? []), r]);
      for (const g of groups.values()) {
        rank(g, (r, p) => {
          if (key === 'sectionId') r.sectionPosition = p;
          else r.classPosition = p;
        });
      }
    }
    await this.prisma.$transaction([
      this.prisma.resultSummary.deleteMany({ where: { termId: term.id, studentId: { notIn: rows.map((r) => r.studentId) } } }),
      ...rows.map(({ classId: _c, ...r }) =>
        this.prisma.resultSummary.upsert({
          where: { termId_studentId: { termId: term.id, studentId: r.studentId } },
          update: r,
          create: { termId: term.id, ...r },
        }),
      ),
    ]);
  }

  // ================= marks entry sheet (13.2, PDF2 Teacher 6) =================
  async sheet(termId: string, courseId: string, user: AuthUser) {
    const term = await this.getTerm(termId);
    const course = await this.assertCourse(user, courseId);
    if (course.academicYearId !== term.academicYearId) throw new BadRequestException('This subject is not in the result’s academic year.');
    const [enrollments, entries] = await Promise.all([
      this.prisma.studentEnrollment.findMany({
        where: { sectionId: course.sectionId, academicYearId: term.academicYearId, status: EnrollmentStatus.ACTIVE },
        select: { rollNumber: true, student: { select: { id: true, admissionNo: true, user: { select: { firstName: true, lastName: true } } } } },
      }),
      this.prisma.resultEntry.findMany({ where: { termId, courseId } }),
    ]);
    return {
      term: { id: term.id, name: term.name, status: term.status, categories: term.categories, gradeScale: term.gradeScale },
      course: { id: course.id, subject: course.subject.name, classLabel: `${course.section.class.name} · ${course.section.name}` },
      students: enrollments
        .map((e) => ({ studentId: e.student.id, name: name(e.student.user), rollNumber: e.rollNumber, admissionNo: e.student.admissionNo, entry: entries.find((x) => x.studentId === e.student.id) ?? null }))
        .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true })),
    };
  }

  /** "Automatic": fill the categories the portal already knows (papers, quizzes, assignments, homework); cells typed by hand stay. */
  async autoFill(termId: string, courseId: string, user: AuthUser) {
    const term = await this.getTerm(termId);
    this.assertOpen(term);
    await this.assertCourse(user, courseId);
    await this.rebuild(termId, { refreshAuto: true, courseIds: [courseId] });
    return this.sheet(termId, courseId, user);
  }

  /** "Manual": save the grid (marks per category, grace, remarks); totals and grades are worked out again. */
  async saveSheet(termId: string, dto: SaveSheetDto, user: AuthUser) {
    const term = await this.getTerm(termId);
    this.assertOpen(term);
    const course = await this.assertCourse(user, dto.courseId);
    const cats = term.categories as unknown as Category[];
    const enrolled = new Set(
      (await this.prisma.studentEnrollment.findMany({ where: { sectionId: course.sectionId, academicYearId: term.academicYearId, status: EnrollmentStatus.ACTIVE }, select: { studentId: true } })).map((e) => e.studentId),
    );
    if (dto.rows.some((r) => !enrolled.has(r.studentId))) throw new BadRequestException('A student in the sheet is not in this class.');
    await this.prisma.$transaction(
      dto.rows.map((r) => {
        const marks = this.cleanMarks(cats, r.marks) as unknown as Prisma.InputJsonValue;
        const data = { marks, grace: r.grace ?? 0, remarks: r.remarks?.trim() || null };
        return this.prisma.resultEntry.upsert({
          where: { termId_courseId_studentId: { termId, courseId: dto.courseId, studentId: r.studentId } },
          update: data,
          create: { termId, courseId: dto.courseId, studentId: r.studentId, ...data },
        });
      }),
    );
    await this.rebuild(termId, { refreshAuto: false, courseIds: [dto.courseId] });
    return this.sheet(termId, dto.courseId, user);
  }

  // ================= compile / lock / publish =================
  async compile(id: string) {
    const t = await this.getTerm(id);
    this.assertOpen(t);
    await this.rebuild(id, { refreshAuto: true });
    return this.prisma.resultTerm.update({ where: { id }, data: { status: ResultTermStatus.COMPILED, compiledAt: new Date() } });
  }

  async recalculate(id: string) {
    const t = await this.getTerm(id);
    this.assertOpen(t);
    await this.rebuild(id, { refreshAuto: false });
    return this.prisma.resultTerm.update({ where: { id }, data: { status: ResultTermStatus.COMPILED, compiledAt: new Date() } });
  }

  async lock(id: string) {
    const t = await this.getTerm(id);
    if (t.status !== ResultTermStatus.COMPILED) throw new ConflictException(t.status === 'LOCKED' ? 'Already locked.' : 'Compile the result before locking it.');
    return this.prisma.resultTerm.update({ where: { id }, data: { status: ResultTermStatus.LOCKED, lockedAt: new Date() } });
  }

  /** "Reopen for correction": unlocked again and hidden from students until it is locked and published again. */
  async reopen(id: string) {
    const t = await this.getTerm(id);
    if (t.status !== ResultTermStatus.LOCKED) throw new ConflictException('Only a locked result can be reopened.');
    return this.prisma.resultTerm.update({ where: { id }, data: { status: ResultTermStatus.COMPILED, lockedAt: null, publishedAt: null } });
  }

  async publish(id: string, published: boolean) {
    const t = await this.getTerm(id);
    if (published && t.status !== ResultTermStatus.LOCKED) throw new ConflictException('Lock the result before publishing it.');
    return this.prisma.resultTerm.update({ where: { id }, data: { publishedAt: published ? new Date() : null } });
  }

  /** Compilation status audit: per class subject — students, marks complete, last change. */
  async audit(id: string) {
    const term = await this.getTerm(id);
    const cats = term.categories as unknown as Category[];
    const courses = await this.prisma.course.findMany({
      where: { academicYearId: term.academicYearId, isActive: true },
      select: { id: true, sectionId: true, subject: { select: { name: true } }, section: { select: { name: true, class: { select: { name: true, level: true } } } }, teacher: { select: { user: { select: { firstName: true, lastName: true } } } } },
    });
    const [entries, counts] = await Promise.all([
      this.prisma.resultEntry.findMany({ where: { termId: id }, select: { courseId: true, marks: true, percent: true, updatedAt: true } }),
      this.prisma.studentEnrollment.groupBy({ by: ['sectionId'], where: { academicYearId: term.academicYearId, status: EnrollmentStatus.ACTIVE }, _count: { _all: true } }),
    ]);
    return courses
      .map((c) => {
        const mine = entries.filter((e) => e.courseId === c.id);
        const used = cats.filter((k) => k.weight > 0 && mine.some((e) => (e.marks as any)?.[k.key]?.obtained != null));
        const complete = mine.filter((e) => used.length && used.every((k) => (e.marks as any)?.[k.key]?.obtained != null)).length;
        return {
          courseId: c.id,
          subject: c.subject.name,
          classLabel: `${c.section.class.name} · ${c.section.name}`,
          level: c.section.class.level,
          teacher: name(c.teacher.user),
          students: counts.find((x) => x.sectionId === c.sectionId)?._count._all ?? 0,
          entries: mine.length,
          complete,
          categoriesWithMarks: used.map((k) => k.name),
          lastUpdated: mine.reduce<Date | null>((m, e) => (!m || e.updatedAt > m ? e.updatedAt : m), null),
        };
      })
      .sort((a, b) => a.level - b.level || a.classLabel.localeCompare(b.classLabel) || a.subject.localeCompare(b.subject));
  }

  // ================= results data (marks sheet, report cards, gazettes) =================
  private async studentRows(termId: string, where: Prisma.ResultSummaryWhereInput) {
    const summaries = await this.prisma.resultSummary.findMany({
      where: { termId, ...where },
      include: {
        section: { select: { id: true, name: true, class: { select: { id: true, name: true, level: true } } } },
        student: {
          select: {
            id: true,
            admissionNo: true,
            user: { select: { firstName: true, lastName: true, gender: true, avatarKey: true } },
            enrollments: { where: { status: EnrollmentStatus.ACTIVE }, select: { rollNumber: true, sectionId: true } },
            parents: { select: { relation: true, parent: { select: { user: { select: { firstName: true, lastName: true, phone: true } } } } } },
          },
        },
      },
    });
    const entries = await this.prisma.resultEntry.findMany({
      where: { termId, studentId: { in: summaries.map((s) => s.studentId) } },
      include: { course: { select: { id: true, subject: { select: { name: true, code: true } }, teacher: { select: { user: { select: { firstName: true, lastName: true } } } } } } },
    });
    return summaries
      .map((s) => {
        const father = s.student.parents.find((l) => l.relation === 'FATHER')?.parent.user;
        const mother = s.student.parents.find((l) => l.relation === 'MOTHER')?.parent.user;
        return {
          ...s,
          name: name(s.student.user),
          gender: s.student.user.gender,
          avatarKey: s.student.user.avatarKey,
          admissionNo: s.student.admissionNo,
          rollNumber: s.student.enrollments.find((e) => e.sectionId === s.sectionId)?.rollNumber ?? '',
          classLabel: `${s.section.class.name} · ${s.section.name}`,
          classId: s.section.class.id,
          level: s.section.class.level,
          fatherName: name(father),
          fatherPhone: father?.phone ?? null,
          motherPhone: mother?.phone ?? null,
          student: undefined,
          entries: entries
            .filter((e) => e.studentId === s.studentId)
            .map((e) => ({ id: e.id, courseId: e.courseId, subject: e.course.subject.name, teacher: name(e.course.teacher.user), marks: e.marks, grace: e.grace, percent: e.percent, grade: e.grade, gradePoint: e.gradePoint, passed: e.passed, remarks: e.remarks }))
            .sort((a, b) => a.subject.localeCompare(b.subject)),
        };
      })
      .sort((a, b) => a.level - b.level || a.classLabel.localeCompare(b.classLabel) || a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }));
  }

  async results(termId: string, q: ResultsQueryDto, user: AuthUser) {
    const term = await this.getTerm(termId);
    const allowed = await this.sectionIdsFor(user);
    if (q.sectionId && allowed && !allowed.includes(q.sectionId)) throw new ForbiddenException('You can only see the results of classes you teach.');
    const where: Prisma.ResultSummaryWhereInput = {
      ...(q.sectionId ? { sectionId: q.sectionId } : allowed ? { sectionId: { in: allowed } } : {}),
      ...(q.classId ? { section: { classId: q.classId } } : {}),
    };
    return { term, students: await this.studentRows(termId, where) };
  }

  async updateSummary(id: string, dto: UpdateSummaryDto, user: AuthUser) {
    const s = await this.prisma.resultSummary.findUnique({ where: { id }, include: { term: true } });
    if (!s) throw new NotFoundException('Result not found');
    this.assertOpen(s.term);
    const allowed = await this.sectionIdsFor(user);
    if (allowed && !allowed.includes(s.sectionId)) throw new ForbiddenException('You can only write remarks for classes you teach.');
    if (dto.principalRemarks !== undefined && user.role !== Role.ADMIN) throw new ForbiddenException("Only the office can write the principal's remarks.");
    return this.prisma.resultSummary.update({
      where: { id },
      data: {
        ...(dto.teacherRemarks !== undefined ? { teacherRemarks: dto.teacherRemarks.trim() || null } : {}),
        ...(dto.principalRemarks !== undefined ? { principalRemarks: dto.principalRemarks.trim() || null } : {}),
        ...(dto.coCurricular !== undefined ? { coCurricular: dto.coCurricular.map((c) => ({ activity: c.activity.trim(), grade: c.grade.trim() })) as unknown as Prisma.InputJsonValue } : {}),
      },
    });
  }

  // ================= report card settings (13.3) =================
  async settings() {
    const s = await this.prisma.reportCardSettings.findFirst();
    return s ?? { template: 'STANDARD', schoolName: null, principalName: null, logoKey: null, signatureKey: null, footerNote: null, saved: false };
  }

  async saveSettings(dto: ReportCardSettingsDto, user: AuthUser) {
    const current = await this.prisma.reportCardSettings.findFirst();
    const image = async (ref: { key: string; name: string } | null | undefined, old: string | null | undefined) => {
      if (ref === undefined) return old ?? null;
      if (ref === null) return null;
      if (ref.key === old) return old;
      const [f] = await ownUploads(this.prisma, user, [ref], MediaPurpose.AVATAR);
      if (!/^image\/(png|jpeg|jpg|webp)$/.test(f.mime)) throw new BadRequestException('The logo and signature must be PNG, JPG or WebP images.');
      return f.key;
    };
    const data = {
      template: dto.template,
      schoolName: dto.schoolName?.trim() || null,
      principalName: dto.principalName?.trim() || null,
      footerNote: dto.footerNote?.trim() || null,
      logoKey: await image(dto.logo, current?.logoKey),
      signatureKey: await image(dto.signature, current?.signatureKey),
    };
    return current ? this.prisma.reportCardSettings.update({ where: { id: current.id }, data }) : this.prisma.reportCardSettings.create({ data });
  }

  // ================= student / parent (PDF2 Student 5–7) =================
  private async studentProfileId(user: AuthUser) {
    const s = await this.prisma.studentProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!s) throw new ForbiddenException('Student profile not found');
    return s.id;
  }

  async childId(user: AuthUser, studentId: string) {
    const parent = await this.prisma.parentProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!parent || !(await this.prisma.parentStudentLink.findFirst({ where: { parentId: parent.id, studentId } }))) throw new ForbiddenException('Not a parent of this student');
    return studentId;
  }

  /** Published results (report cards) of one student, newest first, with class size and the report-card settings. */
  async resultCards(studentId: string) {
    const terms = await this.prisma.resultTerm.findMany({
      where: { publishedAt: { not: null }, summaries: { some: { studentId } } },
      include: { gradeScale: true, academicYear: { select: { id: true, name: true } } },
      orderBy: { publishedAt: 'desc' },
    });
    const cards: { term: (typeof terms)[number]; student: Awaited<ReturnType<ResultsService["studentRows"]>>[number]; sectionSize: number; classSize: number }[] = [];
    for (const t of terms) {
      const [row] = await this.studentRows(t.id, { studentId });
      if (!row) continue;
      const [sectionSize, classSize] = await Promise.all([
        this.prisma.resultSummary.count({ where: { termId: t.id, sectionId: row.sectionId, percent: { not: null } } }),
        this.prisma.resultSummary.count({ where: { termId: t.id, section: { classId: row.classId }, percent: { not: null } } }),
      ]);
      cards.push({ term: t, student: row, sectionSize, classSize });
    }
    return { cards, settings: await this.settings() };
  }

  /** PDF2 Student 5: marks and grades of papers, quizzes, homework, assignments and teacher assessments. */
  async grades(studentId: string) {
    const [exams, attempts, assignments, homework, terms] = await Promise.all([
      this.prisma.examResult.findMany({
        where: { studentId, publishedAt: { not: null } },
        include: { examPaper: { select: { maxMarks: true, scheduledAt: true, exam: { select: { name: true } }, course: { select: { subject: { select: { name: true } } } } } } },
      }),
      this.prisma.quizAttempt.findMany({
        where: { studentId, status: AttemptStatus.GRADED, score: { not: null }, quiz: { endAt: { lt: new Date() } } },
        include: { quiz: { select: { title: true, totalMarks: true, endAt: true, course: { select: { subject: { select: { name: true } } } } } } },
        orderBy: { submittedAt: 'desc' },
      }),
      this.prisma.assignmentSubmission.findMany({
        where: { studentId, grade: { isNot: null } },
        include: { grade: true, assignment: { select: { title: true, maxMarks: true, dueDate: true, course: { select: { subject: { select: { name: true } } } } } } },
        orderBy: { submittedAt: 'desc' },
      }),
      this.prisma.diarySubmission.findMany({
        where: { studentId, checked: true },
        include: { diaryEntry: { select: { date: true, course: { select: { subject: { select: { name: true } } } } } } },
        orderBy: { submittedAt: 'desc' },
        take: 300,
      }),
      this.prisma.resultTerm.findMany({ where: { publishedAt: { not: null }, entries: { some: { studentId } } }, select: { id: true, name: true, categories: true, entries: { where: { studentId }, select: { marks: true, course: { select: { subject: { select: { name: true } } } } } } } }),
    ]);
    const assessments = terms.flatMap((t) =>
      (t.categories as unknown as Category[])
        .filter((c) => c.source === 'MANUAL')
        .flatMap((c) =>
          t.entries
            .map((e) => ({ cell: (e.marks as any)?.[c.key] as Cell | undefined, subject: e.course.subject.name }))
            .filter((x) => x.cell && x.cell.obtained != null)
            .map((x) => ({ result: t.name, category: c.name, subject: x.subject, obtained: x.cell!.obtained, max: x.cell!.max })),
        ),
    );
    return {
      papers: exams.map((r) => ({ exam: r.examPaper.exam.name, subject: r.examPaper.course.subject.name, date: r.examPaper.scheduledAt, obtained: r.marksObtained, max: r.examPaper.maxMarks, grade: r.grade, remarks: r.remarks })),
      quizzes: attempts.map((a) => ({ title: a.quiz.title, subject: a.quiz.course.subject.name, date: a.submittedAt ?? a.quiz.endAt, obtained: a.score, max: a.quiz.totalMarks })),
      assignments: assignments.map((s) => ({ title: s.assignment.title, subject: s.assignment.course.subject.name, date: s.assignment.dueDate, obtained: s.grade!.marksObtained, max: s.assignment.maxMarks, stars: s.grade!.stars, emoji: s.grade!.emoji, feedback: s.grade!.feedback })),
      homework: homework.map((h) => ({ subject: h.diaryEntry.course.subject.name, date: h.diaryEntry.date, grade: h.grade, stars: h.stars, remarks: h.remarks })),
      assessments,
    };
  }

  async myResultCards(user: AuthUser) {
    return this.resultCards(await this.studentProfileId(user));
  }

  async myGrades(user: AuthUser) {
    return this.grades(await this.studentProfileId(user));
  }

  async childResultCards(user: AuthUser, studentId: string) {
    return this.resultCards(await this.childId(user, studentId));
  }

  async childGrades(user: AuthUser, studentId: string) {
    return this.grades(await this.childId(user, studentId));
  }
}
