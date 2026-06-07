import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttemptStatus,
  QuestionType,
  Role,
  ShowResultsPolicy,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  CreateQuestionDto,
  CreateQuizDto,
  ManualGradeAnswerDto,
  RecordViolationDto,
  SaveAnswerDto,
  SubmitAttemptDto,
  UpdateQuestionDto,
  UpdateQuizDto,
} from './dto/quiz.dto';
import { shuffle } from './shuffle.util';

@Injectable()
export class QuizzesService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertCourseTeacher(courseId: string, user: AuthUser) {
    if (user.role === Role.ADMIN) return;
    if (user.role !== Role.TEACHER) throw new ForbiddenException();
    const c = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: { teacher: true },
    });
    if (!c) throw new NotFoundException();
    if (c.teacher.userId !== user.id) throw new ForbiddenException();
  }

  // ==================== Quiz CRUD ====================
  async create(courseId: string, user: AuthUser, dto: CreateQuizDto) {
    await this.assertCourseTeacher(courseId, user);
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (endAt <= startAt) {
      throw new BadRequestException('endAt must be after startAt');
    }
    return this.prisma.quiz.create({
      data: {
        courseId,
        title: dto.title,
        description: dto.description,
        instructions: dto.instructions,
        passMarks: dto.passMarks,
        durationMinutes: dto.durationMinutes,
        startAt,
        endAt,
        maxAttempts: dto.maxAttempts ?? 1,
        shuffleQuestions: dto.shuffleQuestions ?? true,
        shuffleOptions: dto.shuffleOptions ?? true,
        showResultsAfter:
          dto.showResultsAfter ?? ShowResultsPolicy.AFTER_END,
        isExam: dto.isExam ?? false,
        antiCheatEnabled: dto.antiCheatEnabled ?? true,
        maxViolations: dto.maxViolations ?? 3,
      },
    });
  }

  listForCourse(courseId: string) {
    return this.prisma.quiz.findMany({
      where: { courseId },
      orderBy: { startAt: 'desc' },
      include: { _count: { select: { questions: true, attempts: true } } },
    });
  }

  async get(id: string, user: AuthUser) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id },
      include: {
        course: { include: { teacher: true } },
        questions: { include: { options: true } },
      },
    });
    if (!quiz) throw new NotFoundException();
    // Students should not see correct options before taking the quiz.
    if (user.role === Role.STUDENT) {
      return {
        ...quiz,
        questions: quiz.questions.map((q) => ({
          ...q,
          options: q.options.map(({ isCorrect, ...o }) => o),
        })),
      };
    }
    return quiz;
  }

  async update(id: string, user: AuthUser, dto: UpdateQuizDto) {
    const q = await this.prisma.quiz.findUnique({ where: { id } });
    if (!q) throw new NotFoundException();
    await this.assertCourseTeacher(q.courseId, user);
    return this.prisma.quiz.update({
      where: { id },
      data: {
        ...dto,
        startAt: dto.startAt ? new Date(dto.startAt) : undefined,
        endAt: dto.endAt ? new Date(dto.endAt) : undefined,
      },
    });
  }

  async delete(id: string, user: AuthUser) {
    const q = await this.prisma.quiz.findUnique({ where: { id } });
    if (!q) throw new NotFoundException();
    await this.assertCourseTeacher(q.courseId, user);
    return this.prisma.quiz.delete({ where: { id } });
  }

  async publish(id: string, user: AuthUser) {
    return this.update(id, user, { isPublished: true });
  }

  // ==================== Questions ====================
  async addQuestion(quizId: string, user: AuthUser, dto: CreateQuestionDto) {
    const quiz = await this.prisma.quiz.findUnique({ where: { id: quizId } });
    if (!quiz) throw new NotFoundException();
    await this.assertCourseTeacher(quiz.courseId, user);

    if (this.requiresOptions(dto.type) && (!dto.options || dto.options.length < 2)) {
      throw new BadRequestException(
        `${dto.type} questions require at least 2 options`,
      );
    }
    if (dto.type === QuestionType.MCQ_SINGLE) {
      const correct = (dto.options ?? []).filter((o) => o.isCorrect).length;
      if (correct !== 1) {
        throw new BadRequestException('MCQ_SINGLE must have exactly one correct option');
      }
    }
    if (dto.type === QuestionType.MCQ_MULTI) {
      const correct = (dto.options ?? []).filter((o) => o.isCorrect).length;
      if (correct < 1) {
        throw new BadRequestException('MCQ_MULTI must have at least one correct option');
      }
    }

    const created = await this.prisma.question.create({
      data: {
        quizId,
        type: dto.type,
        text: dto.text,
        imageKey: dto.imageKey,
        marks: dto.marks,
        negativeMarks: dto.negativeMarks ?? 0,
        orderIndex: dto.orderIndex,
        explanation: dto.explanation,
        options: dto.options?.length
          ? {
              createMany: {
                data: dto.options.map((o) => ({
                  text: o.text,
                  isCorrect: o.isCorrect ?? false,
                  orderIndex: o.orderIndex,
                })),
              },
            }
          : undefined,
      },
      include: { options: true },
    });
    await this.recalculateTotal(quizId);
    return created;
  }

  async updateQuestion(id: string, user: AuthUser, dto: UpdateQuestionDto) {
    const existing = await this.prisma.question.findUnique({
      where: { id },
      include: { quiz: true },
    });
    if (!existing) throw new NotFoundException();
    await this.assertCourseTeacher(existing.quiz.courseId, user);

    return this.prisma.$transaction(async (tx) => {
      await tx.question.update({
        where: { id },
        data: {
          type: dto.type,
          text: dto.text,
          imageKey: dto.imageKey,
          marks: dto.marks,
          negativeMarks: dto.negativeMarks,
          orderIndex: dto.orderIndex,
          explanation: dto.explanation,
        },
      });
      if (dto.options) {
        await tx.option.deleteMany({ where: { questionId: id } });
        if (dto.options.length) {
          await tx.option.createMany({
            data: dto.options.map((o) => ({
              questionId: id,
              text: o.text,
              isCorrect: o.isCorrect ?? false,
              orderIndex: o.orderIndex,
            })),
          });
        }
      }
      const q = await tx.question.findUnique({
        where: { id },
        include: { options: true },
      });
      await this.recalculateTotal(existing.quizId, tx);
      return q;
    });
  }

  async deleteQuestion(id: string, user: AuthUser) {
    const existing = await this.prisma.question.findUnique({
      where: { id },
      include: { quiz: true },
    });
    if (!existing) throw new NotFoundException();
    await this.assertCourseTeacher(existing.quiz.courseId, user);
    await this.prisma.question.delete({ where: { id } });
    await this.recalculateTotal(existing.quizId);
    return { success: true };
  }

  private requiresOptions(type: QuestionType) {
    return (
      type === QuestionType.MCQ_SINGLE ||
      type === QuestionType.MCQ_MULTI ||
      type === QuestionType.TRUE_FALSE
    );
  }

  private async recalculateTotal(quizId: string, tx: any = this.prisma) {
    const agg = await tx.question.aggregate({
      where: { quizId },
      _sum: { marks: true },
    });
    await tx.quiz.update({
      where: { id: quizId },
      data: { totalMarks: Math.round(agg._sum.marks ?? 0) },
    });
  }

  // ==================== Attempts ====================
  private async getStudent(user: AuthUser) {
    const s = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      include: { enrollments: true },
    });
    if (!s) throw new ForbiddenException('Student profile not found');
    return s;
  }

  async startAttempt(quizId: string, user: AuthUser) {
    if (user.role !== Role.STUDENT) throw new ForbiddenException();
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        course: true,
        questions: { include: { options: true } },
      },
    });
    if (!quiz) throw new NotFoundException();
    if (!quiz.isPublished) {
      throw new BadRequestException('Quiz is not published');
    }

    const now = new Date();
    if (now < quiz.startAt) {
      throw new BadRequestException('Quiz has not started yet');
    }
    if (now > quiz.endAt) {
      throw new BadRequestException('Quiz window has closed');
    }

    const student = await this.getStudent(user);
    const enrolled = student.enrollments.some(
      (e) => e.sectionId === quiz.course.sectionId,
    );
    if (!enrolled) throw new ForbiddenException('Not enrolled in this course');

    const existingInProgress = await this.prisma.quizAttempt.findFirst({
      where: {
        quizId,
        studentId: student.id,
        status: AttemptStatus.IN_PROGRESS,
      },
    });
    if (existingInProgress) return this.getAttemptView(existingInProgress.id, user);

    const prior = await this.prisma.quizAttempt.count({
      where: { quizId, studentId: student.id },
    });
    if (prior >= quiz.maxAttempts) {
      throw new BadRequestException('Maximum attempts reached');
    }

    const qIds = quiz.questions.map((q) => q.id);
    const questionOrder = quiz.shuffleQuestions ? shuffle(qIds) : qIds;
    const optionOrder: Record<string, string[]> = {};
    for (const q of quiz.questions) {
      const opts = q.options.map((o) => o.id);
      optionOrder[q.id] = quiz.shuffleOptions ? shuffle(opts) : opts;
    }

    const deadlineAt = new Date(
      Math.min(
        now.getTime() + quiz.durationMinutes * 60_000,
        quiz.endAt.getTime(),
      ),
    );

    const attempt = await this.prisma.quizAttempt.create({
      data: {
        quizId,
        studentId: student.id,
        attemptNumber: prior + 1,
        startedAt: now,
        deadlineAt,
        questionOrder,
        optionOrder,
      },
    });
    return this.getAttemptView(attempt.id, user);
  }

  async getAttemptView(attemptId: string, user: AuthUser) {
    const attempt = await this.prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      include: {
        quiz: {
          include: { questions: { include: { options: true } } },
        },
        answers: true,
      },
    });
    if (!attempt) throw new NotFoundException();
    if (user.role === Role.STUDENT) {
      const student = await this.getStudent(user);
      if (attempt.studentId !== student.id) throw new ForbiddenException();
    }

    const questionMap = new Map(
      attempt.quiz.questions.map((q) => [q.id, q]),
    );
    const ordered = (attempt.questionOrder as string[])
      .map((qid) => questionMap.get(qid))
      .filter(Boolean) as typeof attempt.quiz.questions;

    const orderedView = ordered.map((q) => {
      const optOrder =
        (attempt.optionOrder as any as Record<string, string[]>)?.[q.id] ?? [];
      const optMap = new Map(q.options.map((o) => [o.id, o]));
      const options = optOrder
        .map((oid) => optMap.get(oid))
        .filter(Boolean)
        .map((o: any) =>
          attempt.status === AttemptStatus.IN_PROGRESS && user.role === Role.STUDENT
            ? { id: o.id, text: o.text, orderIndex: o.orderIndex }
            : o,
        );
      return {
        id: q.id,
        type: q.type,
        text: q.text,
        imageKey: q.imageKey,
        marks: q.marks,
        options,
      };
    });

    return {
      attemptId: attempt.id,
      quiz: {
        id: attempt.quiz.id,
        title: attempt.quiz.title,
        instructions: attempt.quiz.instructions,
        durationMinutes: attempt.quiz.durationMinutes,
        antiCheatEnabled: attempt.quiz.antiCheatEnabled,
        maxViolations: attempt.quiz.maxViolations,
      },
      status: attempt.status,
      startedAt: attempt.startedAt,
      deadlineAt: attempt.deadlineAt,
      violationCount: attempt.violationCount,
      score: attempt.score,
      questions: orderedView,
      answers: attempt.answers.map((a) => ({
        questionId: a.questionId,
        selectedOptionIds: a.selectedOptionIds,
        textAnswer: a.textAnswer,
      })),
    };
  }

  async saveAnswer(attemptId: string, user: AuthUser, dto: SaveAnswerDto) {
    if (user.role !== Role.STUDENT) throw new ForbiddenException();
    const attempt = await this.getInProgressAttempt(attemptId, user);

    return this.prisma.quizAnswer.upsert({
      where: {
        attemptId_questionId: {
          attemptId: attempt.id,
          questionId: dto.questionId,
        },
      },
      update: {
        selectedOptionIds: dto.selectedOptionIds ?? [],
        textAnswer: dto.textAnswer,
        answeredAt: new Date(),
      },
      create: {
        attemptId: attempt.id,
        questionId: dto.questionId,
        selectedOptionIds: dto.selectedOptionIds ?? [],
        textAnswer: dto.textAnswer,
      },
    });
  }

  private async getInProgressAttempt(attemptId: string, user: AuthUser) {
    const student = await this.getStudent(user);
    const attempt = await this.prisma.quizAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) throw new NotFoundException();
    if (attempt.studentId !== student.id) throw new ForbiddenException();
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('Attempt is no longer in progress');
    }
    if (new Date() > attempt.deadlineAt) {
      await this.autoSubmit(attempt.id);
      throw new BadRequestException('Attempt deadline has passed');
    }
    return attempt;
  }

  async recordViolation(
    attemptId: string,
    user: AuthUser,
    dto: RecordViolationDto,
  ) {
    if (user.role !== Role.STUDENT) throw new ForbiddenException();
    const attempt = await this.getInProgressAttempt(attemptId, user);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.quizViolation.create({
        data: {
          attemptId: attempt.id,
          type: dto.type,
          metadata: dto.metadata as any,
        },
      });
      return tx.quizAttempt.update({
        where: { id: attempt.id },
        data: { violationCount: { increment: 1 } },
        include: { quiz: true },
      });
    });

    if (
      updated.quiz.antiCheatEnabled &&
      updated.violationCount >= updated.quiz.maxViolations
    ) {
      await this.autoSubmit(attempt.id);
      return {
        attemptId: attempt.id,
        violationCount: updated.violationCount,
        autoSubmitted: true,
      };
    }
    return {
      attemptId: attempt.id,
      violationCount: updated.violationCount,
      autoSubmitted: false,
    };
  }

  async submitAttempt(
    attemptId: string,
    user: AuthUser,
    dto: SubmitAttemptDto,
  ) {
    if (user.role !== Role.STUDENT) throw new ForbiddenException();
    const student = await this.getStudent(user);
    const attempt = await this.prisma.quizAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) throw new NotFoundException();
    if (attempt.studentId !== student.id) throw new ForbiddenException();
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('Attempt already submitted');
    }
    if (dto.answers?.length) {
      for (const ans of dto.answers) {
        await this.prisma.quizAnswer.upsert({
          where: {
            attemptId_questionId: {
              attemptId,
              questionId: ans.questionId,
            },
          },
          update: {
            selectedOptionIds: ans.selectedOptionIds ?? [],
            textAnswer: ans.textAnswer,
          },
          create: {
            attemptId,
            questionId: ans.questionId,
            selectedOptionIds: ans.selectedOptionIds ?? [],
            textAnswer: ans.textAnswer,
          },
        });
      }
    }
    return this.finalizeAttempt(attemptId, AttemptStatus.SUBMITTED);
  }

  async autoSubmit(attemptId: string) {
    return this.finalizeAttempt(attemptId, AttemptStatus.AUTO_SUBMITTED);
  }

  /** Auto-grades objective types. Subjective questions must be graded manually. */
  private async finalizeAttempt(attemptId: string, status: AttemptStatus) {
    const attempt = await this.prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      include: {
        quiz: {
          include: { questions: { include: { options: true } } },
        },
        answers: true,
      },
    });
    if (!attempt) throw new NotFoundException();
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      return attempt;
    }

    let total = 0;
    let hasSubjective = false;
    const updates: Promise<any>[] = [];

    const questionMap = new Map(
      attempt.quiz.questions.map((q) => [q.id, q]),
    );

    for (const ans of attempt.answers) {
      const q = questionMap.get(ans.questionId);
      if (!q) continue;
      if (q.type === QuestionType.SHORT_ANSWER || q.type === QuestionType.LONG_ANSWER) {
        hasSubjective = true;
        continue;
      }
      const correctIds = q.options.filter((o) => o.isCorrect).map((o) => o.id);
      const selected = ans.selectedOptionIds ?? [];
      let isCorrect = false;
      if (q.type === QuestionType.MCQ_SINGLE || q.type === QuestionType.TRUE_FALSE) {
        isCorrect = selected.length === 1 && correctIds.includes(selected[0]);
      } else if (q.type === QuestionType.MCQ_MULTI) {
        const a = new Set(selected);
        const b = new Set(correctIds);
        isCorrect =
          a.size === b.size && [...a].every((x) => b.has(x));
      }
      const marks = isCorrect ? q.marks : -q.negativeMarks;
      total += marks;
      updates.push(
        this.prisma.quizAnswer.update({
          where: { id: ans.id },
          data: { marksAwarded: marks, isCorrect },
        }),
      );
    }
    await Promise.all(updates);

    return this.prisma.quizAttempt.update({
      where: { id: attemptId },
      data: {
        status: hasSubjective ? status : AttemptStatus.GRADED,
        submittedAt: new Date(),
        score: total,
      },
    });
  }

  async listAttempts(quizId: string, user: AuthUser) {
    const q = await this.prisma.quiz.findUnique({ where: { id: quizId } });
    if (!q) throw new NotFoundException();
    await this.assertCourseTeacher(q.courseId, user);
    return this.prisma.quizAttempt.findMany({
      where: { quizId },
      include: {
        student: { include: { user: true } },
        _count: { select: { violations: true, answers: true } },
      },
      orderBy: { submittedAt: 'desc' },
    });
  }

  async getAttemptForTeacher(attemptId: string, user: AuthUser) {
    const attempt = await this.prisma.quizAttempt.findUnique({
      where: { id: attemptId },
      include: {
        quiz: {
          include: { questions: { include: { options: true } }, course: true },
        },
        answers: true,
        violations: true,
        student: { include: { user: true } },
      },
    });
    if (!attempt) throw new NotFoundException();
    await this.assertCourseTeacher(attempt.quiz.courseId, user);
    return attempt;
  }

  async manualGrade(
    attemptId: string,
    user: AuthUser,
    items: ManualGradeAnswerDto[],
  ) {
    const attempt = await this.getAttemptForTeacher(attemptId, user);
    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        await tx.quizAnswer.update({
          where: { id: item.answerId },
          data: {
            marksAwarded: item.marksAwarded,
            isCorrect: item.isCorrect,
          },
        });
      }
      const totals = await tx.quizAnswer.aggregate({
        where: { attemptId },
        _sum: { marksAwarded: true },
      });
      await tx.quizAttempt.update({
        where: { id: attemptId },
        data: {
          score: totals._sum.marksAwarded ?? 0,
          status: AttemptStatus.GRADED,
        },
      });
    });
    return this.prisma.quizAttempt.findUnique({ where: { id: attemptId } });
  }
}
