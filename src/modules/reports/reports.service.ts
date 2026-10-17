import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const pct = (got: number, max: number) => (max > 0 ? Math.round((got / max) * 1000) / 10 : null);
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** Student growth report (PDF 6.2): attendance month by month, exam results term by term, assignment and quiz averages. */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async studentGrowth(studentId: string, months = 6) {
    const s = await this.prisma.studentProfile.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        admissionNo: true,
        admissionDate: true,
        user: { select: { firstName: true, lastName: true, avatarKey: true, dateOfBirth: true } },
        enrollments: {
          where: { status: 'ACTIVE', academicYear: { isCurrent: true } },
          take: 1,
          select: { rollNumber: true, section: { select: { name: true, class: { select: { name: true } } } } },
        },
      },
    });
    if (!s) throw new NotFoundException('Student not found');

    // ---- attendance: whole-day records of the last N months (oldest first) ----
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
    const records = await this.prisma.attendanceRecord.findMany({
      where: { studentId, courseId: null, date: { gte: from } },
      select: { date: true, status: true },
    });
    const attendance = Array.from({ length: months }, (_, i) => {
      const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1));
      const inMonth = records.filter((r) => monthKey(r.date) === monthKey(d));
      const c = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 } as Record<string, number>;
      for (const r of inMonth) c[r.status] = (c[r.status] ?? 0) + 1;
      return { month: monthKey(d), days: inMonth.length, counts: c, percent: pct(c.PRESENT + c.LATE, inMonth.length) };
    });

    // ---- exams: each exam's subjects, total and % ----
    const results = await this.prisma.examResult.findMany({
      where: { studentId },
      select: {
        marksObtained: true,
        examPaper: {
          select: {
            maxMarks: true,
            course: { select: { subject: { select: { name: true } } } },
            exam: { select: { id: true, name: true, startDate: true } },
          },
        },
      },
    });
    const examMap = new Map<string, { id: string; name: string; startDate: Date; subjects: { subject: string; marks: number; maxMarks: number; percent: number | null }[] }>();
    for (const r of results) {
      const e = r.examPaper.exam;
      if (!examMap.has(e.id)) examMap.set(e.id, { id: e.id, name: e.name, startDate: e.startDate, subjects: [] });
      examMap.get(e.id)!.subjects.push({
        subject: r.examPaper.course.subject.name,
        marks: r.marksObtained,
        maxMarks: r.examPaper.maxMarks,
        percent: pct(r.marksObtained, r.examPaper.maxMarks),
      });
    }
    const exams = [...examMap.values()]
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
      .map((e) => {
        const marks = e.subjects.reduce((t, x) => t + x.marks, 0);
        const max = e.subjects.reduce((t, x) => t + x.maxMarks, 0);
        return { ...e, subjects: e.subjects.sort((a, b) => a.subject.localeCompare(b.subject)), marks, maxMarks: max, percent: pct(marks, max) };
      });

    // ---- assignments (graded) and quizzes (latest finished attempt per quiz) ----
    const graded = await this.prisma.assignmentSubmission.findMany({
      where: { studentId, grade: { isNot: null } },
      select: { grade: { select: { marksObtained: true } }, assignment: { select: { maxMarks: true } } },
    });
    const aGot = graded.reduce((t, g) => t + (g.grade?.marksObtained ?? 0), 0);
    const aMax = graded.reduce((t, g) => t + g.assignment.maxMarks, 0);
    const attempts = await this.prisma.quizAttempt.findMany({
      where: { studentId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED', 'GRADED'] }, score: { not: null } },
      orderBy: { submittedAt: 'desc' },
      select: { quizId: true, score: true, quiz: { select: { totalMarks: true } } },
    });
    const latest = [...new Map(attempts.map((a) => [a.quizId, a])).values()].filter((a) => a.quiz.totalMarks > 0);
    const qGot = latest.reduce((t, a) => t + (a.score ?? 0), 0);
    const qMax = latest.reduce((t, a) => t + a.quiz.totalMarks, 0);

    const e = s.enrollments[0];
    return {
      student: {
        id: s.id,
        name: `${s.user.firstName} ${s.user.lastName}`.trim(),
        admissionNo: s.admissionNo,
        admissionDate: s.admissionDate,
        avatarKey: s.user.avatarKey,
        classLabel: e ? `${e.section.class.name} · ${e.section.name}` : null,
        rollNumber: e?.rollNumber ?? null,
      },
      attendance,
      exams,
      assignments: { count: graded.length, percent: pct(aGot, aMax) },
      quizzes: { count: latest.length, percent: pct(qGot, qMax) },
    };
  }
}
