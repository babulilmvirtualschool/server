import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EnrollmentStatus, ExamPaperMode, MediaPurpose, Prisma, Role, ShowResultsPolicy } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { ownUploads } from '../../common/utils/own-uploads';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateExamDto,
  CreateExamPaperDto,
  DuplicateExamPaperDto,
  ListExamPapersQueryDto,
  RecordExamResultDto,
  UpdateExamDto,
  UpdateExamPaperDto,
} from './dto/exam.dto';
import { publicUserSelect } from '../../common/utils/public-user.select';

const name = (u?: { firstName: string; lastName: string } | null) => (u ? `${u.firstName} ${u.lastName}`.trim() : '');
const endOf = (p: { scheduledAt: Date; durationMinutes: number }) => new Date(p.scheduledAt.getTime() + p.durationMinutes * 60_000);
const statusOf = (p: { scheduledAt: Date; durationMinutes: number }, now = new Date()) =>
  now < p.scheduledAt ? 'UPCOMING' : now < endOf(p) ? 'ACTIVE' : 'COMPLETED';

const paperInclude = {
  exam: true,
  course: {
    include: {
      subject: true,
      section: { include: { class: true } },
      teacher: { select: { id: true, userId: true, user: { select: { firstName: true, lastName: true } } } },
    },
  },
  invigilator: { select: { id: true, employeeCode: true, user: { select: { firstName: true, lastName: true } } } },
  quiz: { select: { id: true, isPublished: true, totalMarks: true, _count: { select: { questions: true, attempts: true } } } },
} satisfies Prisma.ExamPaperInclude;
type PaperRow = Prisma.ExamPaperGetPayload<{ include: typeof paperInclude }>;

@Injectable()
export class ExamsService {
  constructor(private readonly prisma: PrismaService) {}

  createExam(dto: CreateExamDto) {
    return this.prisma.exam.create({
      data: {
        academicYearId: dto.academicYearId,
        name: dto.name,
        type: dto.type,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        published: dto.published ?? false,
      },
    });
  }

  listExams(academicYearId?: string) {
    return this.prisma.exam.findMany({
      where: academicYearId ? { academicYearId } : undefined,
      orderBy: { startDate: 'desc' },
      include: { _count: { select: { papers: true } } },
    });
  }

  async getExam(id: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      include: {
        papers: {
          orderBy: { scheduledAt: 'asc' },
          include: {
            course: {
              include: { subject: true, section: { include: { class: true } } },
            },
            quiz: true,
            invigilator: { select: { id: true, employeeCode: true, user: { select: { firstName: true, lastName: true } } } },
            _count: { select: { questions: true } },
          },
        },
      },
    });
    if (!exam) throw new NotFoundException();
    return exam;
  }

  updateExam(id: string, dto: UpdateExamDto) {
    return this.prisma.exam.update({
      where: { id },
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
  }

  deleteExam(id: string) {
    return this.prisma.exam.delete({ where: { id } });
  }

  // ---------- exam / online test setup (PDF1 10.1) ----------

  /** Admin: any course. Teacher: only courses they teach. */
  private async assertCourseAccess(courseId: string, user?: AuthUser) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId }, include: { subject: true, teacher: { select: { userId: true } } } });
    if (!course) throw new NotFoundException('Course not found');
    if (user && user.role === Role.TEACHER && course.teacher.userId !== user.id) {
      throw new ForbiddenException('You can only set exams for the classes you teach');
    }
    return course;
  }

  paperView(p: PaperRow) {
    const { course, invigilator, ...rest } = p;
    return {
      ...rest,
      endAt: endOf(p),
      status: statusOf(p),
      course: {
        id: course.id,
        subject: { id: course.subject.id, name: course.subject.name, code: course.subject.code },
        section: { id: course.section.id, name: course.section.name, class: { id: course.section.class.id, name: course.section.class.name } },
        teacher: { id: course.teacher.id, name: name(course.teacher.user) },
      },
      classLabel: `${course.section.class.name} · ${course.section.name}`,
      invigilator: invigilator ? { id: invigilator.id, name: name(invigilator.user), employeeCode: invigilator.employeeCode } : null,
    };
  }

  private async checkInvigilator(id?: string) {
    if (!id) return null;
    const t = await this.prisma.teacherProfile.findUnique({ where: { id }, select: { id: true } });
    if (!t) throw new BadRequestException({ message: 'Choose an invigilator from the staff list.', fields: { invigilatorId: 'Not found' } });
    return t.id;
  }

  private passMarks(maxMarks: number, passingPercent?: number | null) {
    return passingPercent == null ? null : Math.round((maxMarks * passingPercent) / 100);
  }

  /** The online test (quiz) behind an ONLINE paper: open exactly for the paper's time slot, one attempt, results after it ends. */
  private quizData(title: string, scheduledAt: Date, durationMinutes: number, maxMarks: number, passingPercent?: number | null) {
    return {
      title,
      durationMinutes,
      startAt: scheduledAt,
      endAt: new Date(scheduledAt.getTime() + durationMinutes * 60_000),
      passMarks: this.passMarks(maxMarks, passingPercent),
    };
  }

  async createPaper(examId: string, dto: CreateExamPaperDto, user?: AuthUser) {
    const [exam, course] = await Promise.all([
      this.prisma.exam.findUnique({ where: { id: examId } }),
      this.assertCourseAccess(dto.courseId, user),
    ]);
    if (!exam) throw new NotFoundException('Exam not found');
    if (course.academicYearId !== exam.academicYearId) {
      throw new BadRequestException(
        'This subject belongs to a different academic year than the exam',
      );
    }
    const existing = await this.prisma.examPaper.findUnique({
      where: { examId_courseId: { examId, courseId: dto.courseId } },
    });
    if (existing) {
      throw new ConflictException(
        'This subject already has a paper in this exam for this class',
      );
    }
    const invigilatorId = await this.checkInvigilator(dto.invigilatorId);
    const file = dto.paperFile && user ? (await ownUploads(this.prisma, user, [dto.paperFile], MediaPurpose.CONTENT_DOCUMENT))[0] : null;
    const scheduledAt = new Date(dto.scheduledAt);
    const title = dto.title?.trim() || `${exam.name} — ${course.subject.name}`;
    const mode = dto.mode ?? ExamPaperMode.MANUAL;
    const created = await this.prisma.$transaction(async (tx) => {
      const quiz =
        mode === ExamPaperMode.ONLINE && !dto.quizId
          ? await tx.quiz.create({
              data: {
                courseId: course.id,
                ...this.quizData(title, scheduledAt, dto.durationMinutes, dto.maxMarks, dto.passingPercent),
                instructions: dto.instructions?.trim() || null,
                isExam: true,
                maxAttempts: 1,
                showResultsAfter: ShowResultsPolicy.AFTER_END,
              },
            })
          : null;
      return tx.examPaper.create({
        data: {
          examId,
          courseId: dto.courseId,
          quizId: quiz?.id ?? dto.quizId,
          scheduledAt,
          durationMinutes: dto.durationMinutes,
          maxMarks: dto.maxMarks,
          venue: dto.venue?.trim() || null,
          title,
          mode,
          passingPercent: dto.passingPercent ?? null,
          weightage: dto.weightage ?? null,
          paperCode: dto.paperCode?.trim() || null,
          invigilatorId,
          instructions: dto.instructions?.trim() || null,
          paperFileKey: file?.key ?? null,
          paperFileName: file?.name ?? null,
        },
        include: paperInclude,
      });
    });
    return this.paperView(created);
  }

  /** Schedule / reschedule and edit; an online test follows the new time slot. */
  async updatePaper(paperId: string, dto: UpdateExamPaperDto, user?: AuthUser) {
    const paper = await this.prisma.examPaper.findUnique({ where: { id: paperId }, include: { quiz: { include: { _count: { select: { attempts: true } } } } } });
    if (!paper) throw new NotFoundException('Exam paper not found');
    await this.assertCourseAccess(paper.courseId, user);
    const invigilatorId = dto.invigilatorId === undefined ? undefined : await this.checkInvigilator(dto.invigilatorId || undefined);
    let file: { key: string; name: string } | null | undefined;
    if (dto.paperFile === null) file = null;
    else if (dto.paperFile) {
      file = dto.paperFile.key === paper.paperFileKey ? { key: paper.paperFileKey, name: paper.paperFileName ?? dto.paperFile.name } : user ? (await ownUploads(this.prisma, user, [dto.paperFile], MediaPurpose.CONTENT_DOCUMENT))[0] : null;
    }
    const next = {
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : paper.scheduledAt,
      durationMinutes: dto.durationMinutes ?? paper.durationMinutes,
      maxMarks: dto.maxMarks ?? paper.maxMarks,
      title: dto.title !== undefined ? dto.title.trim() || paper.title : paper.title,
      mode: dto.mode ?? paper.mode,
      passingPercent: dto.passingPercent !== undefined ? dto.passingPercent : paper.passingPercent,
    };
    const updated = await this.prisma.$transaction(async (tx) => {
      let quizId = paper.quizId;
      if (next.mode === ExamPaperMode.ONLINE) {
        const data = { ...this.quizData(next.title ?? 'Online test', next.scheduledAt, next.durationMinutes, next.maxMarks, next.passingPercent), ...(dto.instructions !== undefined ? { instructions: dto.instructions?.trim() || null } : {}) };
        if (paper.quiz) await tx.quiz.update({ where: { id: paper.quiz.id }, data });
        else quizId = (await tx.quiz.create({ data: { courseId: paper.courseId, ...data, isExam: true, maxAttempts: 1, showResultsAfter: ShowResultsPolicy.AFTER_END } })).id;
      } else if (paper.quiz) {
        if (paper.quiz._count.attempts) throw new ConflictException('Students have already taken this online test, so it cannot become a manual paper.');
        await tx.quiz.delete({ where: { id: paper.quiz.id } });
        quizId = null;
      }
      return tx.examPaper.update({
        where: { id: paperId },
        data: {
          ...(dto.scheduledAt ? { scheduledAt: next.scheduledAt } : {}),
          ...(dto.durationMinutes !== undefined ? { durationMinutes: dto.durationMinutes } : {}),
          ...(dto.maxMarks !== undefined ? { maxMarks: dto.maxMarks } : {}),
          ...(dto.venue !== undefined ? { venue: dto.venue?.trim() || null } : {}),
          ...(dto.title !== undefined ? { title: next.title } : {}),
          ...(dto.mode !== undefined ? { mode: dto.mode } : {}),
          ...(dto.passingPercent !== undefined ? { passingPercent: dto.passingPercent } : {}),
          ...(dto.weightage !== undefined ? { weightage: dto.weightage } : {}),
          ...(dto.paperCode !== undefined ? { paperCode: dto.paperCode?.trim() || null } : {}),
          ...(invigilatorId !== undefined ? { invigilatorId } : {}),
          ...(dto.instructions !== undefined ? { instructions: dto.instructions?.trim() || null } : {}),
          ...(file !== undefined ? { paperFileKey: file?.key ?? null, paperFileName: file?.name ?? null } : {}),
          quizId,
        },
        include: paperInclude,
      });
    });
    return this.paperView(updated);
  }

  /** Removes a paper from the date sheet; refused once results have been entered or the online test was taken. */
  async deletePaper(paperId: string, user?: AuthUser) {
    const paper = await this.prisma.examPaper.findUnique({
      where: { id: paperId },
      include: { _count: { select: { results: true } }, quiz: { include: { _count: { select: { attempts: true } } } } },
    });
    if (!paper) throw new NotFoundException('Exam paper not found');
    await this.assertCourseAccess(paper.courseId, user);
    if (paper._count.results > 0) {
      throw new ConflictException(
        'Results have already been entered for this paper, so it cannot be removed',
      );
    }
    if (paper.quiz?._count.attempts) throw new ConflictException('Students have already taken this online test, so it cannot be removed.');
    await this.prisma.$transaction(async (tx) => {
      await tx.examPaper.delete({ where: { id: paperId } });
      if (paper.quiz) await tx.quiz.delete({ where: { id: paper.quiz.id } });
    });
    return { id: paperId };
  }

  /** PDF1 10.1 list: every exam / online test with filters (course, class, exam type, mode, status, dates). */
  async listPapers(q: ListExamPapersQueryDto, user: AuthUser) {
    const now = new Date();
    const rows = await this.prisma.examPaper.findMany({
      where: {
        ...(q.examId ? { examId: q.examId } : {}),
        ...(q.courseId ? { courseId: q.courseId } : {}),
        ...(q.mode ? { mode: q.mode } : {}),
        exam: { ...(q.academicYearId ? { academicYearId: q.academicYearId } : {}), ...(q.examType ? { type: q.examType } : {}) },
        course: {
          ...(q.sectionId ? { sectionId: q.sectionId } : {}),
          ...(q.classId ? { section: { classId: q.classId } } : {}),
          ...(q.mine === 'true' && user.role === Role.TEACHER ? { teacher: { userId: user.id } } : {}),
        },
        ...(q.from || q.to
          ? { scheduledAt: { ...(q.from ? { gte: new Date(`${q.from.slice(0, 10)}T00:00:00.000Z`) } : {}), ...(q.to ? { lt: new Date(new Date(`${q.to.slice(0, 10)}T00:00:00.000Z`).getTime() + 86_400_000) } : {}) } }
          : {}),
      },
      include: paperInclude,
      orderBy: { scheduledAt: 'asc' },
      take: 1000,
    });
    return rows
      .filter((r) => !q.status || statusOf(r, now) === q.status)
      .map((r) => ({ ...this.paperView(r), canEdit: user.role === Role.ADMIN || r.course.teacher.userId === user.id }));
  }

  /** PDF1 10.1 "Duplicate Exam": copy a paper — and its online test questions — to another class (same subject or not). */
  async duplicatePaper(paperId: string, dto: DuplicateExamPaperDto, user: AuthUser) {
    const src = await this.prisma.examPaper.findUnique({
      where: { id: paperId },
      include: { quiz: { include: { questions: { include: { options: true }, orderBy: { orderIndex: 'asc' } } } } },
    });
    if (!src) throw new NotFoundException('Exam paper not found');
    await this.assertCourseAccess(src.courseId, user);
    const examId = dto.examId ?? src.examId;
    const created = await this.createPaper(
      examId,
      {
        courseId: dto.courseId,
        scheduledAt: (dto.scheduledAt ? new Date(dto.scheduledAt) : src.scheduledAt).toISOString(),
        durationMinutes: src.durationMinutes,
        maxMarks: src.maxMarks,
        venue: src.venue ?? undefined,
        mode: src.mode,
        passingPercent: src.passingPercent ?? undefined,
        weightage: src.weightage ?? undefined,
        instructions: src.instructions ?? undefined,
      },
      user,
    );
    await this.prisma.examPaper.update({ where: { id: created.id }, data: { paperFileKey: src.paperFileKey, paperFileName: src.paperFileName } });
    if (created.quizId && src.quiz?.questions.length) {
      for (const q of src.quiz.questions) {
        await this.prisma.question.create({
          data: {
            quizId: created.quizId,
            type: q.type,
            text: q.text,
            imageKey: q.imageKey,
            marks: q.marks,
            negativeMarks: q.negativeMarks,
            orderIndex: q.orderIndex,
            explanation: q.explanation,
            options: q.options.length ? { createMany: { data: q.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect, orderIndex: o.orderIndex })) } } : undefined,
          },
        });
      }
      const agg = await this.prisma.question.aggregate({ where: { quizId: created.quizId }, _sum: { marks: true } });
      await this.prisma.quiz.update({ where: { id: created.quizId }, data: { totalMarks: Math.round(agg._sum.marks ?? 0) } });
    }
    const row = await this.prisma.examPaper.findUniqueOrThrow({ where: { id: created.id }, include: paperInclude });
    return this.paperView(row);
  }

  /**
   * PDF1 10.2 "Auto-Detect Room/Teacher Conflicts": papers of this exam that overlap in time with another paper (of any exam in the same
   * academic year) in the same class, the same room, or with the same invigilator.
   */
  async invigilators() {
    const rows = await this.prisma.teacherProfile.findMany({
      where: { user: { isActive: true, role: { in: [Role.TEACHER, Role.STAFF] } } },
      select: { id: true, employeeCode: true, designation: true, user: { select: { firstName: true, lastName: true, role: true } } },
      orderBy: [{ user: { firstName: 'asc' } }, { user: { lastName: 'asc' } }],
      take: 500,
    });
    return rows.map((t) => ({ id: t.id, name: name(t.user), employeeCode: t.employeeCode, kind: t.user.role, designation: t.designation }));
  }

  async conflicts(examId: string) {
    const exam = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) throw new NotFoundException('Exam not found');
    const papers = await this.prisma.examPaper.findMany({ where: { exam: { academicYearId: exam.academicYearId } }, include: paperInclude, orderBy: { scheduledAt: 'asc' } });
    const out: { type: 'CLASS' | 'ROOM' | 'INVIGILATOR'; detail: string; papers: ReturnType<ExamsService['paperView']>[] }[] = [];
    const overlap = (a: PaperRow, b: PaperRow) => a.scheduledAt < endOf(b) && b.scheduledAt < endOf(a);
    for (let i = 0; i < papers.length; i++) {
      for (let j = i + 1; j < papers.length; j++) {
        const a = papers[i];
        const b = papers[j];
        if ((a.examId !== examId && b.examId !== examId) || !overlap(a, b)) continue;
        const pair = [this.paperView(a), this.paperView(b)];
        if (a.course.sectionId === b.course.sectionId) out.push({ type: 'CLASS', detail: `${pair[0].classLabel} has two papers at the same time`, papers: pair });
        if (a.venue && b.venue && a.venue.trim().toLowerCase() === b.venue.trim().toLowerCase()) out.push({ type: 'ROOM', detail: `Room ${a.venue} is used twice`, papers: pair });
        if (a.invigilatorId && a.invigilatorId === b.invigilatorId) out.push({ type: 'INVIGILATOR', detail: `${pair[0].invigilator?.name} invigilates two papers`, papers: pair });
      }
    }
    return { examId, conflicts: out };
  }

  /** PDF2 Student 2 "Show date sheet and exams (file, text, Online Quiz)": published exams of the student's classes. */
  async myExams(user: AuthUser) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { id: true, enrollments: { where: { status: EnrollmentStatus.ACTIVE }, select: { sectionId: true } } },
    });
    if (!student) throw new ForbiddenException('Student profile not found');
    const rows = await this.prisma.examPaper.findMany({
      where: { exam: { published: true }, course: { sectionId: { in: student.enrollments.map((e) => e.sectionId) } } },
      include: paperInclude,
      orderBy: { scheduledAt: 'asc' },
    });
    const quizIds = rows.map((r) => r.quizId).filter((x): x is string => !!x);
    const attempts = quizIds.length
      ? await this.prisma.quizAttempt.findMany({ where: { studentId: student.id, quizId: { in: quizIds } }, select: { id: true, quizId: true, status: true, score: true } })
      : [];
    const now = new Date();
    return rows.map((r) => {
      const v = this.paperView(r);
      const started = now >= r.scheduledAt;
      const att = attempts.find((a) => a.quizId === r.quizId) ?? null;
      return {
        ...v,
        // The question paper / text is shown only once the exam has started.
        paperFileKey: started ? r.paperFileKey : null,
        paperFileName: started ? r.paperFileName : null,
        instructions: started ? r.instructions : null,
        quiz: r.quiz ? { id: r.quiz.id, isPublished: r.quiz.isPublished, totalMarks: r.quiz.totalMarks } : null,
        myAttempt: att ? { id: att.id, status: att.status, score: v.status === 'COMPLETED' ? att.score : null } : null,
      };
    });
  }

  private async findPaperOrThrow(paperId: string) {
    const paper = await this.prisma.examPaper.findUnique({
      where: { id: paperId },
      include: { course: true },
    });
    if (!paper) throw new NotFoundException('Exam paper not found');
    return paper;
  }

  /** Generated paper: schedule details + the bank questions selected for it, in order. */
  async getPaper(paperId: string) {
    const paper = await this.prisma.examPaper.findUnique({
      where: { id: paperId },
      include: {
        exam: true,
        course: {
          include: { subject: true, section: { include: { class: true } } },
        },
        questions: {
          orderBy: { orderIndex: 'asc' },
          include: { question: true },
        },
      },
    });
    if (!paper) throw new NotFoundException('Exam paper not found');
    const questionMarks = paper.questions.reduce(
      (sum, q) => sum + q.question.marks,
      0,
    );
    return { ...paper, questionMarks };
  }

  /** Paper generator: replace the paper's questions with the given bank questions (same subject), in order. */
  async setPaperQuestions(paperId: string, questionIds: string[]) {
    const paper = await this.findPaperOrThrow(paperId);
    const found = await this.prisma.bankQuestion.findMany({
      where: { id: { in: questionIds } },
      select: { id: true, subjectId: true },
    });
    if (found.length !== questionIds.length) {
      throw new BadRequestException('One or more questions were not found');
    }
    if (found.some((q) => q.subjectId !== paper.course.subjectId)) {
      throw new BadRequestException(
        "Only questions from this paper's subject can be added",
      );
    }
    await this.prisma.$transaction([
      this.prisma.examPaperQuestion.deleteMany({ where: { examPaperId: paperId } }),
      this.prisma.examPaperQuestion.createMany({
        data: questionIds.map((questionId, orderIndex) => ({
          examPaperId: paperId,
          questionId,
          orderIndex,
        })),
      }),
    ]);
    return this.getPaper(paperId);
  }

  async recordResult(paperId: string, dto: RecordExamResultDto) {
    return this.prisma.examResult.upsert({
      where: {
        examPaperId_studentId: {
          examPaperId: paperId,
          studentId: dto.studentId,
        },
      },
      update: {
        marksObtained: dto.marksObtained,
        grade: dto.grade,
        remarks: dto.remarks,
      },
      create: {
        examPaperId: paperId,
        studentId: dto.studentId,
        marksObtained: dto.marksObtained,
        grade: dto.grade,
        remarks: dto.remarks,
      },
    });
  }

  async bulkRecordResults(paperId: string, items: RecordExamResultDto[]) {
    return this.prisma.$transaction(
      items.map((r) =>
        this.prisma.examResult.upsert({
          where: {
            examPaperId_studentId: {
              examPaperId: paperId,
              studentId: r.studentId,
            },
          },
          update: {
            marksObtained: r.marksObtained,
            grade: r.grade,
            remarks: r.remarks,
          },
          create: {
            examPaperId: paperId,
            studentId: r.studentId,
            marksObtained: r.marksObtained,
            grade: r.grade,
            remarks: r.remarks,
          },
        }),
      ),
    );
  }

  publishResults(paperId: string) {
    return this.prisma.examResult.updateMany({
      where: { examPaperId: paperId },
      data: { publishedAt: new Date() },
    });
  }

  async resultsForStudent(studentUserId: string) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: studentUserId },
    });
    if (!student) return [];
    return this.prisma.examResult.findMany({
      where: { studentId: student.id, publishedAt: { not: null } },
      include: {
        examPaper: {
          include: {
            exam: true,
            course: { include: { subject: true } },
          },
        },
      },
      orderBy: { examPaper: { scheduledAt: 'desc' } },
    });
  }

  resultsForPaper(paperId: string) {
    return this.prisma.examResult.findMany({
      where: { examPaperId: paperId },
      include: { student: { include: { user: { select: publicUserSelect } } } },
    });
  }
}
