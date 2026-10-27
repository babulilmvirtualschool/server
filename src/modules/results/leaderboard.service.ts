import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AttemptStatus, EnrollmentStatus, Role } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/** Client (25 Oct): ranked by an overall score combining result %, stars / points, homework and quizzes. */
export const LEADERBOARD_WEIGHTS = { result: 40, quizzes: 20, homework: 20, stars: 20 } as const;
type Part = keyof typeof LEADERBOARD_WEIGHTS;
const round = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? xs.reduce((m, x) => m + x, 0) / xs.length : null);
const name = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();

/**
 * PDF2 Leaderboards (Teacher 10, Student 3 / 9): this academic year's scores — result % of the latest published result, quizzes / online tests %,
 * homework (diary homework handed in + assignment marks) and stars (assignments + homework, out of 5). Parts a student has no data for are left
 * out and the others re-weighted.
 */
@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  private async scores(yearId: string) {
    const enrollments = await this.prisma.studentEnrollment.findMany({
      where: { academicYearId: yearId, status: EnrollmentStatus.ACTIVE },
      select: {
        studentId: true,
        sectionId: true,
        rollNumber: true,
        section: { select: { name: true, class: { select: { name: true, level: true } } } },
        student: { select: { user: { select: { firstName: true, lastName: true, avatarKey: true } } } },
      },
    });
    const ids = enrollments.map((e) => e.studentId);
    const [term, attempts, grades, diary] = await Promise.all([
      this.prisma.resultTerm.findFirst({ where: { academicYearId: yearId, publishedAt: { not: null } }, orderBy: { publishedAt: 'desc' }, select: { id: true, name: true } }),
      this.prisma.quizAttempt.findMany({
        where: { studentId: { in: ids }, status: AttemptStatus.GRADED, score: { not: null }, quiz: { totalMarks: { gt: 0 }, endAt: { lt: new Date() }, course: { academicYearId: yearId } } },
        select: { studentId: true, quizId: true, score: true, quiz: { select: { totalMarks: true } } },
      }),
      this.prisma.assignmentGrade.findMany({
        where: { submission: { studentId: { in: ids }, assignment: { course: { academicYearId: yearId } } } },
        select: { marksObtained: true, stars: true, submission: { select: { studentId: true, assignment: { select: { maxMarks: true } } } } },
      }),
      // Diary entries of the year that had homework (someone handed it in), per class.
      this.prisma.diaryEntry.findMany({
        where: { course: { academicYearId: yearId }, submissions: { some: {} } },
        select: { course: { select: { sectionId: true } }, submissions: { select: { studentId: true, stars: true } } },
      }),
    ]);
    const summaries = term ? await this.prisma.resultSummary.findMany({ where: { termId: term.id }, select: { studentId: true, percent: true } }) : [];
    const rows = enrollments.map((e) => {
      const s = e.studentId;
      const bestPerQuiz = new Map<string, number>();
      for (const a of attempts.filter((x) => x.studentId === s)) bestPerQuiz.set(a.quizId, Math.max(bestPerQuiz.get(a.quizId) ?? 0, (a.score! / a.quiz.totalMarks) * 100));
      const myGrades = grades.filter((g) => g.submission.studentId === s);
      const homeworkGiven = diary.filter((d) => d.course.sectionId === e.sectionId);
      const handedIn = homeworkGiven.filter((d) => d.submissions.some((x) => x.studentId === s));
      const marksPct = myGrades.filter((g) => g.marksObtained != null && g.submission.assignment.maxMarks > 0).map((g) => (g.marksObtained! / g.submission.assignment.maxMarks) * 100);
      const homeworkParts = [homeworkGiven.length ? (handedIn.length / homeworkGiven.length) * 100 : null, avg(marksPct)].filter((x): x is number => x != null);
      const stars = [...myGrades.map((g) => g.stars), ...handedIn.map((d) => d.submissions.find((x) => x.studentId === s)!.stars)].filter((x): x is number => x != null);
      const parts: Record<Part, number | null> = {
        result: summaries.find((x) => x.studentId === s)?.percent ?? null,
        quizzes: avg([...bestPerQuiz.values()]),
        homework: avg(homeworkParts),
        stars: stars.length ? (avg(stars)! / 5) * 100 : null,
      };
      const used = (Object.keys(parts) as Part[]).filter((k) => parts[k] != null);
      const wsum = used.reduce((m, k) => m + LEADERBOARD_WEIGHTS[k], 0);
      const score = wsum ? used.reduce((m, k) => m + parts[k]! * LEADERBOARD_WEIGHTS[k], 0) / wsum : null;
      return {
        studentId: s,
        sectionId: e.sectionId,
        name: name(e.student.user),
        avatarKey: e.student.user.avatarKey,
        rollNumber: e.rollNumber,
        classLabel: `${e.section.class.name} · ${e.section.name}`,
        level: e.section.class.level,
        result: parts.result == null ? null : round(parts.result),
        quizzes: parts.quizzes == null ? null : round(parts.quizzes),
        homework: parts.homework == null ? null : round(parts.homework),
        stars: parts.stars == null ? null : round(parts.stars),
        starsCount: stars.length,
        score: score == null ? null : round(score),
        rank: null as number | null,
      };
    });
    return { term, rows };
  }

  private ranked<T extends { score: number | null; name: string; rank: number | null }>(rows: T[]) {
    const sorted = rows.filter((r) => r.score != null).sort((a, b) => b.score! - a.score! || a.name.localeCompare(b.name));
    sorted.forEach((r, i) => {
      r.rank = i > 0 && sorted[i - 1].score === r.score ? sorted[i - 1].rank : i + 1;
    });
    return [...sorted, ...rows.filter((r) => r.score == null).sort((a, b) => a.name.localeCompare(b.name))];
  }

  async leaderboard(user: AuthUser, sectionId?: string) {
    const year = await this.prisma.academicYear.findFirst({ where: { isCurrent: true } });
    if (!year) throw new NotFoundException('No current academic year');
    let me: string | null = null;
    let allowed: string[] | null = null;
    if (user.role === Role.STUDENT) {
      const s = await this.prisma.studentProfile.findUnique({ where: { userId: user.id }, select: { id: true, enrollments: { where: { academicYearId: year.id, status: EnrollmentStatus.ACTIVE }, select: { sectionId: true } } } });
      if (!s) throw new ForbiddenException();
      me = s.id;
      allowed = s.enrollments.map((e) => e.sectionId);
      sectionId = allowed[0];
    } else if (user.role === Role.TEACHER) {
      const t = await this.prisma.teacherProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
      if (!t) throw new ForbiddenException();
      const [courses, homeroom] = await Promise.all([
        this.prisma.course.findMany({ where: { teacherId: t.id, academicYearId: year.id }, select: { sectionId: true } }),
        this.prisma.section.findMany({ where: { classTeacherId: t.id, class: { academicYearId: year.id } }, select: { id: true } }),
      ]);
      allowed = [...new Set([...courses.map((c) => c.sectionId), ...homeroom.map((h) => h.id)])];
      if (sectionId && !allowed.includes(sectionId)) throw new ForbiddenException('You can only see the leaderboard of classes you teach.');
      sectionId = sectionId ?? allowed[0];
    }
    const { term, rows } = await this.scores(year.id);
    const school = this.ranked(rows.map((r) => ({ ...r }))).filter((r) => r.rank != null && r.rank <= 10);
    const classRows = sectionId ? this.ranked(rows.filter((r) => r.sectionId === sectionId)) : [];
    const sections = [...new Map(rows.filter((r) => !allowed || allowed.includes(r.sectionId)).map((r) => [r.sectionId, { id: r.sectionId, label: r.classLabel, level: r.level }])).values()].sort(
      (a, b) => a.level - b.level || a.label.localeCompare(b.label),
    );
    return { weights: LEADERBOARD_WEIGHTS, resultTerm: term, sectionId: sectionId ?? null, sections, rows: classRows, school, me };
  }
}
