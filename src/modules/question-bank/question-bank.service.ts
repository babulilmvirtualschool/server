import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BankQuestionType, Prisma, QuestionDifficulty, Role } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BankQuestionBodyDto,
  BulkBankQuestionsDto,
  CreateBankQuestionDto,
  ListBankQuestionsDto,
  UpdateBankQuestionDto,
} from './dto/bank-question.dto';

const BLANK_RE = /_{3,}/;
const TF = ['TRUE', 'FALSE'];
const creatorSelect = { select: { id: true, firstName: true, lastName: true } } as const;
const fail = (message: string, field: string, hint = message) => new BadRequestException({ message, fields: { [field]: hint } });
const clean = (v?: string | null) => (v?.trim() ? v.trim() : null);

type Body = Partial<BankQuestionBodyDto>;

@Injectable()
export class QuestionBankService {
  constructor(private readonly prisma: PrismaService) {}

  /** Subjects a teacher teaches (any class); `null` = everything (admin). */
  async subjectIdsFor(user: AuthUser): Promise<string[] | null> {
    if (user.role === Role.ADMIN) return null;
    const rows = await this.prisma.course.findMany({ where: { teacher: { userId: user.id } }, select: { subjectId: true }, distinct: ['subjectId'] });
    return rows.map((r) => r.subjectId);
  }

  async assertSubject(user: AuthUser, subjectId: string) {
    const subject = await this.prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject) throw new NotFoundException('Subject not found');
    const allowed = await this.subjectIdsFor(user);
    if (allowed && !allowed.includes(subjectId)) throw new ForbiddenException('You can only use the question bank of subjects you teach.');
    return subject;
  }

  /** Admin: any question. Teacher: only questions they added. */
  private assertCanEdit(user: AuthUser, q: { createdById: string | null }) {
    if (user.role !== Role.ADMIN && q.createdById !== user.id) throw new ForbiddenException('You can only change questions you added.');
  }

  /** Validates the type-specific fields and returns the columns to store. */
  normalize(b: Body) {
    const type = b.type as BankQuestionType;
    let text = (b.text ?? '').trim();
    if (!text && type === BankQuestionType.MATCHING) text = 'Match Column A with Column B.';
    if (!text) throw fail('Question text is required', 'text', 'Required');
    let options: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
    let pairs: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
    let parts: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
    let answer = clean(b.answer);

    switch (type) {
      case BankQuestionType.MCQ: {
        const opts = (b.options ?? []).map((o) => ({ text: o.text.trim(), isCorrect: !!o.isCorrect }));
        if (opts.length < 2 || opts.some((o) => !o.text)) throw fail('An MCQ needs 2–6 options, none empty', 'options', 'Add 2–6 options');
        if (opts.filter((o) => o.isCorrect).length !== 1) throw fail('Mark exactly one option as correct', 'options', 'Mark exactly one correct option');
        options = opts;
        answer = null;
        break;
      }
      case BankQuestionType.FILL_BLANK:
        if (!BLANK_RE.test(text)) throw fail('Mark the blank in the question with ____', 'text', 'Mark the blank with ____');
        if (!answer) throw fail('The correct answer is required', 'answer', 'Required');
        break;
      case BankQuestionType.TRUE_FALSE:
      case BankQuestionType.TICK_CROSS:
        answer = answer?.toUpperCase() ?? null;
        if (!answer || !TF.includes(answer)) {
          throw fail(type === BankQuestionType.TRUE_FALSE ? 'Choose True or False as the answer' : 'Choose Tick (✓) or Cross (✗) as the answer', 'answer', 'Required');
        }
        break;
      case BankQuestionType.MATCHING: {
        const list = (b.pairs ?? []).map((p) => ({ left: p.left.trim(), right: p.right.trim() }));
        if (list.length < 2 || list.some((p) => !p.left || !p.right)) throw fail('Matching needs 2–10 complete pairs', 'pairs', 'Add 2–10 pairs');
        pairs = list;
        answer = null;
        break;
      }
      default: {
        // SHORT / LONG: optional solution key and sub-parts.
        const list = (b.parts ?? []).map((p) => ({ text: p.text.trim(), ...(p.marks != null ? { marks: p.marks } : {}), ...(clean(p.answer) ? { answer: clean(p.answer) } : {}) }));
        if (list.some((p) => !p.text)) throw fail('Every part needs its text', 'parts', 'Fill every part');
        if (list.length) parts = list;
      }
    }
    if (type !== BankQuestionType.SHORT && type !== BankQuestionType.LONG && b.parts?.length) throw fail('Only short and long questions can have parts', 'parts', 'Not for this type');
    return {
      type,
      text,
      options,
      pairs,
      parts,
      answer,
      marks: b.marks ?? 1,
      className: clean(b.className),
      chapterNo: b.chapterNo ?? null,
      chapterTitle: clean(b.chapterTitle),
      topic: clean(b.topic),
      difficulty: b.difficulty ?? QuestionDifficulty.MEDIUM,
      explanation: clean(b.explanation),
      isActive: b.isActive ?? true,
    };
  }

  async list(q: ListBankQuestionsDto, user: AuthUser) {
    const search = q.search?.trim();
    const allowed = await this.subjectIdsFor(user);
    if (q.subjectId && allowed && !allowed.includes(q.subjectId)) return [];
    return this.prisma.bankQuestion.findMany({
      where: {
        ...(q.subjectId ? { subjectId: q.subjectId } : allowed ? { subjectId: { in: allowed } } : {}),
        ...(q.type ? { type: q.type } : {}),
        ...(q.difficulty ? { difficulty: q.difficulty } : {}),
        ...(q.className ? { className: q.className } : {}),
        ...(q.chapterNo != null ? { chapterNo: q.chapterNo } : {}),
        ...(q.isActive ? { isActive: q.isActive === 'true' } : {}),
        ...(search
          ? {
              OR: [
                { text: { contains: search, mode: 'insensitive' as const } },
                { topic: { contains: search, mode: 'insensitive' as const } },
                { chapterTitle: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ chapterNo: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 5000,
      include: {
        subject: { select: { id: true, name: true, code: true } },
        createdBy: creatorSelect,
        _count: { select: { paperQuestions: true, paperItems: true } },
      },
    });
  }

  /** Subjects the user may use, with the class names they are taught in (pickers on the bank and paper screens). */
  async subjects(user: AuthUser) {
    const allowed = await this.subjectIdsFor(user);
    const subjects = await this.prisma.subject.findMany({
      where: allowed ? { id: { in: allowed } } : {},
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
    const courses = await this.prisma.course.findMany({
      where: { subjectId: { in: subjects.map((s) => s.id) }, academicYear: { isCurrent: true }, ...(allowed ? { teacher: { userId: user.id } } : {}) },
      select: { subjectId: true, section: { select: { class: { select: { name: true, level: true } } } } },
    });
    const classNames = await this.prisma.class.findMany({ where: { academicYear: { isCurrent: true } }, select: { name: true }, orderBy: { level: 'asc' } });
    return {
      subjects: subjects.map((s) => ({
        ...s,
        classNames: [...new Set(courses.filter((c) => c.subjectId === s.id).map((c) => c.section.class.name))],
      })),
      classNames: [...new Set(classNames.map((c) => c.name))],
    };
  }

  async create(dto: CreateBankQuestionDto, user: AuthUser) {
    await this.assertSubject(user, dto.subjectId);
    return this.prisma.bankQuestion.create({
      data: { subjectId: dto.subjectId, createdById: user.id, ...this.normalize(dto) },
      include: { subject: true, createdBy: creatorSelect },
    });
  }

  /** All rows are checked first; nothing is saved when one is invalid (`errors` lists them with their row number). */
  async bulk(dto: BulkBankQuestionsDto, user: AuthUser) {
    await this.assertSubject(user, dto.subjectId);
    const errors: { row: number; message: string }[] = [];
    const data = dto.rows.map((row, i) => {
      try {
        return { subjectId: dto.subjectId, createdById: user.id, ...this.normalize(row) };
      } catch (e: any) {
        const r = e?.getResponse?.();
        errors.push({ row: i + 1, message: (typeof r === 'object' && r?.message) || e?.message || 'Invalid row' });
        return null;
      }
    });
    if (errors.length) return { created: 0, errors };
    await this.prisma.$transaction(data.map((d) => this.prisma.bankQuestion.create({ data: d! })));
    return { created: data.length, errors: [] };
  }

  async update(id: string, dto: UpdateBankQuestionDto, user: AuthUser) {
    const existing = await this.prisma.bankQuestion.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Question not found');
    this.assertCanEdit(user, existing);
    const merged: Body = {
      type: dto.type ?? existing.type,
      text: dto.text ?? existing.text,
      options: dto.options !== undefined ? dto.options : ((existing.options as any) ?? undefined),
      pairs: dto.pairs !== undefined ? dto.pairs : ((existing.pairs as any) ?? undefined),
      parts: dto.parts !== undefined ? dto.parts : ((existing.parts as any) ?? undefined),
      answer: dto.answer !== undefined ? dto.answer : (existing.answer ?? undefined),
      marks: dto.marks ?? existing.marks,
      className: dto.className !== undefined ? dto.className : (existing.className ?? undefined),
      chapterNo: dto.chapterNo !== undefined ? dto.chapterNo : (existing.chapterNo ?? undefined),
      chapterTitle: dto.chapterTitle !== undefined ? dto.chapterTitle : (existing.chapterTitle ?? undefined),
      topic: dto.topic !== undefined ? dto.topic : (existing.topic ?? undefined),
      difficulty: dto.difficulty ?? existing.difficulty,
      explanation: dto.explanation !== undefined ? dto.explanation : (existing.explanation ?? undefined),
      isActive: dto.isActive ?? existing.isActive,
    };
    // A type change drops the fields of the old type.
    if (dto.type && dto.type !== existing.type) {
      if (dto.options === undefined) merged.options = undefined;
      if (dto.pairs === undefined) merged.pairs = undefined;
      if (dto.parts === undefined) merged.parts = undefined;
      if (dto.answer === undefined) merged.answer = undefined;
    }
    return this.prisma.bankQuestion.update({
      where: { id },
      data: this.normalize(merged),
      include: { subject: true, createdBy: creatorSelect },
    });
  }

  /** PDF1 11.1 "Duplicate": a copy to edit (same subject, class, chapter…). */
  async duplicate(id: string, user: AuthUser) {
    const q = await this.prisma.bankQuestion.findUnique({ where: { id } });
    if (!q) throw new NotFoundException('Question not found');
    await this.assertSubject(user, q.subjectId);
    const { id: _id, createdAt: _c, updatedAt: _u, createdById: _b, options, pairs, parts, ...rest } = q;
    return this.prisma.bankQuestion.create({
      data: {
        ...rest,
        options: options ?? Prisma.DbNull,
        pairs: pairs ?? Prisma.DbNull,
        parts: parts ?? Prisma.DbNull,
        createdById: user.id,
      },
      include: { subject: true, createdBy: creatorSelect },
    });
  }

  async remove(id: string, user: AuthUser) {
    const q = await this.prisma.bankQuestion.findUnique({
      where: { id },
      include: { _count: { select: { paperQuestions: true, paperItems: true } } },
    });
    if (!q) throw new NotFoundException('Question not found');
    this.assertCanEdit(user, q);
    const used = q._count.paperQuestions + q._count.paperItems;
    if (used > 0) {
      throw new ConflictException(`This question is used in ${used} paper(s). Remove it from those papers first, or switch it to inactive.`);
    }
    await this.prisma.bankQuestion.delete({ where: { id } });
    return { id };
  }
}
