import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreatePaperPatternDto,
  CreateQuestionPaperDto,
  GeneratePaperDto,
  ListQuestionPapersDto,
  PatternRowDto,
  SetPaperItemsDto,
  UpdatePaperPatternDto,
  UpdateQuestionPaperDto,
} from './dto/question-paper.dto';
import { QuestionBankService } from './question-bank.service';

const creatorSelect = { select: { id: true, firstName: true, lastName: true } } as const;
const clean = (v?: string | null) => (v?.trim() ? v.trim() : null);
const shuffle = <T>(list: T[]) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const examPaperSelect = {
  select: {
    id: true,
    examId: true,
    scheduledAt: true,
    exam: { select: { name: true } },
    course: { select: { teacher: { select: { userId: true } }, section: { select: { name: true, class: { select: { name: true } } } } } },
  },
} as const;

/** PDF1 12.1–12.3 paper generator: saved patterns, papers (header, layout, questions), automatic and manual selection. */
@Injectable()
export class QuestionPapersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bank: QuestionBankService,
  ) {}

  // ---------- patterns ----------
  async listPatterns(subjectId: string | undefined, user: AuthUser) {
    const allowed = await this.bank.subjectIdsFor(user);
    return this.prisma.paperPattern.findMany({
      where: subjectId ? { subjectId } : allowed ? { subjectId: { in: allowed } } : {},
      include: { subject: { select: { id: true, name: true } }, createdBy: creatorSelect },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async createPattern(dto: CreatePaperPatternDto, user: AuthUser) {
    await this.bank.assertSubject(user, dto.subjectId);
    return this.prisma.paperPattern.create({
      data: {
        name: dto.name.trim(),
        subjectId: dto.subjectId,
        className: clean(dto.className),
        chapters: dto.chapters ?? [],
        rows: dto.rows as unknown as Prisma.InputJsonValue,
        header: (dto.header ?? Prisma.DbNull) as Prisma.InputJsonValue,
        createdById: user.id,
      },
    });
  }

  private async ownPattern(id: string, user: AuthUser) {
    const p = await this.prisma.paperPattern.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Pattern not found');
    if (user.role !== Role.ADMIN && p.createdById !== user.id) throw new ForbiddenException('You can only change patterns you saved.');
    return p;
  }

  async updatePattern(id: string, dto: UpdatePaperPatternDto, user: AuthUser) {
    await this.ownPattern(id, user);
    return this.prisma.paperPattern.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.className !== undefined ? { className: clean(dto.className) } : {}),
        ...(dto.chapters !== undefined ? { chapters: dto.chapters } : {}),
        ...(dto.rows !== undefined ? { rows: dto.rows as unknown as Prisma.InputJsonValue } : {}),
        ...(dto.header !== undefined ? { header: (dto.header ?? Prisma.DbNull) as Prisma.InputJsonValue } : {}),
      },
    });
  }

  async deletePattern(id: string, user: AuthUser) {
    await this.ownPattern(id, user);
    await this.prisma.paperPattern.delete({ where: { id } });
    return { id };
  }

  // ---------- papers ----------
  /** Admin: any paper. Teacher: papers they made, or the paper of a date-sheet exam of their own class. */
  private async access(id: string, user: AuthUser) {
    const p = await this.prisma.questionPaper.findUnique({ where: { id }, include: { examPaper: examPaperSelect } });
    if (!p) throw new NotFoundException('Paper not found');
    if (user.role !== Role.ADMIN && p.createdById !== user.id && p.examPaper?.course.teacher.userId !== user.id) {
      throw new ForbiddenException('This paper belongs to another teacher.');
    }
    return p;
  }

  async listPapers(q: ListQuestionPapersDto, user: AuthUser) {
    const search = q.search?.trim();
    const rows = await this.prisma.questionPaper.findMany({
      where: {
        ...(q.subjectId ? { subjectId: q.subjectId } : {}),
        ...(q.className ? { className: q.className } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(search ? { OR: [{ title: { contains: search, mode: 'insensitive' as const } }, { examName: { contains: search, mode: 'insensitive' as const } }] } : {}),
        ...(user.role === Role.ADMIN ? {} : { OR: [{ createdById: user.id }, { examPaper: { course: { teacher: { userId: user.id } } } }] }),
      },
      include: {
        subject: { select: { id: true, name: true } },
        createdBy: creatorSelect,
        examPaper: examPaperSelect,
        items: { select: { marks: true, question: { select: { marks: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    return rows.map(({ items, ...p }) => ({
      ...p,
      questionCount: items.length,
      itemsMarks: items.reduce((s, i) => s + (i.marks ?? i.question.marks), 0),
    }));
  }

  async getPaper(id: string, user: AuthUser) {
    await this.access(id, user);
    const p = await this.prisma.questionPaper.findUniqueOrThrow({
      where: { id },
      include: {
        subject: { select: { id: true, name: true, code: true } },
        createdBy: creatorSelect,
        examPaper: examPaperSelect,
        items: { orderBy: { orderIndex: 'asc' }, include: { question: true } },
      },
    });
    return { ...p, itemsMarks: p.items.reduce((s, i) => s + (i.marks ?? i.question.marks), 0) };
  }

  private headerData(dto: Partial<CreateQuestionPaperDto>) {
    return {
      ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
      ...(dto.schoolName !== undefined ? { schoolName: clean(dto.schoolName) } : {}),
      ...(dto.examName !== undefined ? { examName: clean(dto.examName) } : {}),
      ...(dto.className !== undefined ? { className: clean(dto.className) } : {}),
      ...(dto.totalMinutes !== undefined ? { totalMinutes: dto.totalMinutes } : {}),
      ...(dto.totalMarks !== undefined ? { totalMarks: dto.totalMarks } : {}),
      ...(dto.instructions !== undefined ? { instructions: clean(dto.instructions) } : {}),
      ...(dto.chapters !== undefined ? { chapters: dto.chapters } : {}),
      ...(dto.layout !== undefined ? { layout: dto.layout as unknown as Prisma.InputJsonValue } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
    };
  }

  async createPaper(dto: CreateQuestionPaperDto, user: AuthUser) {
    await this.bank.assertSubject(user, dto.subjectId);
    const created = await this.prisma.questionPaper.create({
      data: { subjectId: dto.subjectId, createdById: user.id, title: dto.title.trim(), chapters: [], ...this.headerData(dto) },
    });
    return this.getPaper(created.id, user);
  }

  /** Date sheet → "Paper": opens the question paper of an exam paper, creating it from the exam details the first time. */
  async forExamPaper(examPaperId: string, user: AuthUser) {
    const ep = await this.prisma.examPaper.findUnique({
      where: { id: examPaperId },
      include: { exam: true, questionPaper: { select: { id: true } }, course: { include: { subject: true, section: { include: { class: true } }, teacher: true } } },
    });
    if (!ep) throw new NotFoundException('Exam paper not found');
    if (user.role !== Role.ADMIN && ep.course.teacher.userId !== user.id) throw new ForbiddenException('This exam belongs to another teacher\'s class.');
    if (ep.questionPaper) return this.getPaper(ep.questionPaper.id, user);
    const created = await this.prisma.questionPaper.create({
      data: {
        title: ep.title ?? `${ep.exam.name} — ${ep.course.subject.name}`,
        examName: ep.exam.name,
        subjectId: ep.course.subjectId,
        className: ep.course.section.class.name,
        totalMinutes: ep.durationMinutes,
        totalMarks: ep.maxMarks,
        instructions: ep.instructions,
        chapters: [],
        examPaperId: ep.id,
        createdById: user.id,
      },
    });
    return this.getPaper(created.id, user);
  }

  async updatePaper(id: string, dto: UpdateQuestionPaperDto, user: AuthUser) {
    await this.access(id, user);
    await this.prisma.questionPaper.update({ where: { id }, data: this.headerData(dto) });
    return this.getPaper(id, user);
  }

  async deletePaper(id: string, user: AuthUser) {
    await this.access(id, user);
    await this.prisma.questionPaper.delete({ where: { id } });
    return { id };
  }

  /** Mode 2 (manual): replace the paper's questions with these, in this order (same subject only). */
  async setItems(id: string, dto: SetPaperItemsDto, user: AuthUser) {
    const paper = await this.access(id, user);
    const ids = dto.items.map((i) => i.questionId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('A question can be on the paper only once.');
    const found = await this.prisma.bankQuestion.findMany({ where: { id: { in: ids } }, select: { id: true, subjectId: true } });
    if (found.length !== ids.length) throw new BadRequestException('One or more questions were not found.');
    if (found.some((q) => q.subjectId !== paper.subjectId)) throw new BadRequestException("Only questions from this paper's subject can be added.");
    await this.prisma.$transaction([
      this.prisma.questionPaperItem.deleteMany({ where: { paperId: id } }),
      this.prisma.questionPaperItem.createMany({ data: dto.items.map((i, orderIndex) => ({ paperId: id, questionId: i.questionId, orderIndex, marks: i.marks ?? null })) }),
      this.prisma.questionPaper.update({ where: { id }, data: { updatedAt: new Date() } }),
    ]);
    return this.getPaper(id, user);
  }

  /** Active questions of the paper's subject that fit a blueprint row (class: the paper's class or none). */
  private candidates(paper: { subjectId: string; className: string | null; chapters: number[] }, row: Pick<PatternRowDto, 'chapterNo' | 'type' | 'difficulty'>, exclude: string[]) {
    return this.prisma.bankQuestion.findMany({
      where: {
        subjectId: paper.subjectId,
        isActive: true,
        type: row.type,
        ...(row.difficulty ? { difficulty: row.difficulty } : {}),
        ...(row.chapterNo != null ? { chapterNo: row.chapterNo } : paper.chapters.length ? { chapterNo: { in: paper.chapters } } : {}),
        ...(paper.className ? { OR: [{ className: paper.className }, { className: null }] } : {}),
        ...(exclude.length ? { id: { notIn: exclude } } : {}),
      },
      select: { id: true },
    });
  }

  /** Mode 1 (automatic): for every row pick `count` random matching questions; tells which rows had too few. */
  async generate(id: string, dto: GeneratePaperDto, user: AuthUser) {
    const paper = await this.access(id, user);
    const existing = dto.append ? await this.prisma.questionPaperItem.findMany({ where: { paperId: id }, orderBy: { orderIndex: 'asc' } }) : [];
    const picked: { questionId: string; marks: number }[] = existing.map((e) => ({ questionId: e.questionId, marks: e.marks ?? 0 }));
    const shortfalls: { row: number; wanted: number; found: number }[] = [];
    for (const [i, row] of dto.rows.entries()) {
      const pool = shuffle(await this.candidates(paper, row, picked.map((p) => p.questionId)));
      const take = pool.slice(0, row.count);
      if (take.length < row.count) shortfalls.push({ row: i + 1, wanted: row.count, found: take.length });
      picked.push(...take.map((q) => ({ questionId: q.id, marks: row.marks })));
    }
    await this.prisma.$transaction([
      this.prisma.questionPaperItem.deleteMany({ where: { paperId: id } }),
      this.prisma.questionPaperItem.createMany({
        data: picked.map((p, orderIndex) => ({ paperId: id, questionId: p.questionId, orderIndex, marks: p.marks || (existing.find((e) => e.questionId === p.questionId)?.marks ?? null) })),
      }),
      this.prisma.questionPaper.update({ where: { id }, data: { updatedAt: new Date() } }),
    ]);
    return { paper: await this.getPaper(id, user), shortfalls };
  }
}
