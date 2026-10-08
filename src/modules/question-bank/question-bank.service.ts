import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BankQuestionType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BankOptionDto,
  CreateBankQuestionDto,
  ListBankQuestionsDto,
  UpdateBankQuestionDto,
} from './dto/bank-question.dto';

const BLANK_RE = /_{3,}/;

@Injectable()
export class QuestionBankService {
  constructor(private readonly prisma: PrismaService) {}

  /** Validates type-specific fields and returns the columns to store. */
  private normalize(
    type: BankQuestionType,
    text: string,
    options: BankOptionDto[] | null | undefined,
    answer: string | null | undefined,
  ) {
    const cleanText = text.trim();
    if (!cleanText) throw new BadRequestException({ message: 'Question text is required', fields: { text: 'Required' } });

    if (type === BankQuestionType.MCQ) {
      const opts = (options ?? []).map((o) => ({ text: o.text.trim(), isCorrect: !!o.isCorrect }));
      if (opts.length < 2 || opts.some((o) => !o.text)) {
        throw new BadRequestException({ message: 'An MCQ needs 2–6 options, none empty', fields: { options: 'Add 2–6 options' } });
      }
      if (opts.filter((o) => o.isCorrect).length !== 1) {
        throw new BadRequestException({ message: 'Mark exactly one option as correct', fields: { options: 'Mark exactly one correct option' } });
      }
      return { text: cleanText, options: opts as Prisma.InputJsonValue, answer: null };
    }

    // FILL_BLANK
    if (!BLANK_RE.test(cleanText)) {
      throw new BadRequestException({ message: 'Mark the blank in the question with ____', fields: { text: 'Mark the blank with ____' } });
    }
    const cleanAnswer = answer?.trim();
    if (!cleanAnswer) {
      throw new BadRequestException({ message: 'The correct answer is required', fields: { answer: 'Required' } });
    }
    return { text: cleanText, options: Prisma.DbNull, answer: cleanAnswer };
  }

  list(q: ListBankQuestionsDto) {
    const search = q.search?.trim();
    return this.prisma.bankQuestion.findMany({
      where: {
        ...(q.subjectId ? { subjectId: q.subjectId } : {}),
        ...(q.type ? { type: q.type } : {}),
        ...(search ? { text: { contains: search, mode: 'insensitive' as const } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        subject: true,
        _count: { select: { paperQuestions: true } },
      },
    });
  }

  async create(dto: CreateBankQuestionDto) {
    const subject = await this.prisma.subject.findUnique({ where: { id: dto.subjectId } });
    if (!subject) throw new NotFoundException('Subject not found');
    const data = this.normalize(dto.type, dto.text, dto.options, dto.answer);
    return this.prisma.bankQuestion.create({
      data: { subjectId: dto.subjectId, type: dto.type, marks: dto.marks ?? 1, ...data },
      include: { subject: true },
    });
  }

  async update(id: string, dto: UpdateBankQuestionDto) {
    const existing = await this.prisma.bankQuestion.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Question not found');
    const type = dto.type ?? existing.type;
    const data = this.normalize(
      type,
      dto.text ?? existing.text,
      dto.options !== undefined ? dto.options : (existing.options as unknown as BankOptionDto[] | null),
      dto.answer !== undefined ? dto.answer : existing.answer,
    );
    return this.prisma.bankQuestion.update({
      where: { id },
      data: { type, ...(dto.marks !== undefined ? { marks: dto.marks } : {}), ...data },
      include: { subject: true },
    });
  }

  async remove(id: string) {
    const q = await this.prisma.bankQuestion.findUnique({
      where: { id },
      include: { _count: { select: { paperQuestions: true } } },
    });
    if (!q) throw new NotFoundException('Question not found');
    if (q._count.paperQuestions > 0) {
      throw new ConflictException(
        `This question is used in ${q._count.paperQuestions} exam paper(s). Remove it from those papers first.`,
      );
    }
    await this.prisma.bankQuestion.delete({ where: { id } });
    return { id };
  }
}
