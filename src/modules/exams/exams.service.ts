import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateExamDto,
  CreateExamPaperDto,
  RecordExamResultDto,
  UpdateExamDto,
  UpdateExamPaperDto,
} from './dto/exam.dto';
import { publicUserSelect } from '../../common/utils/public-user.select';

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

  async createPaper(examId: string, dto: CreateExamPaperDto) {
    const [exam, course] = await Promise.all([
      this.prisma.exam.findUnique({ where: { id: examId } }),
      this.prisma.course.findUnique({ where: { id: dto.courseId } }),
    ]);
    if (!exam) throw new NotFoundException('Exam not found');
    if (!course) throw new NotFoundException('Course not found');
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
    return this.prisma.examPaper.create({
      data: {
        examId,
        courseId: dto.courseId,
        quizId: dto.quizId,
        scheduledAt: new Date(dto.scheduledAt),
        durationMinutes: dto.durationMinutes,
        maxMarks: dto.maxMarks,
        venue: dto.venue,
      },
    });
  }

  async updatePaper(paperId: string, dto: UpdateExamPaperDto) {
    await this.findPaperOrThrow(paperId);
    return this.prisma.examPaper.update({
      where: { id: paperId },
      data: {
        ...(dto.scheduledAt ? { scheduledAt: new Date(dto.scheduledAt) } : {}),
        ...(dto.durationMinutes !== undefined
          ? { durationMinutes: dto.durationMinutes }
          : {}),
        ...(dto.maxMarks !== undefined ? { maxMarks: dto.maxMarks } : {}),
        ...(dto.venue !== undefined ? { venue: dto.venue?.trim() || null } : {}),
      },
    });
  }

  /** Removes a paper from the date sheet; refused once results have been entered (they would be lost). */
  async deletePaper(paperId: string) {
    const paper = await this.prisma.examPaper.findUnique({
      where: { id: paperId },
      include: { _count: { select: { results: true } } },
    });
    if (!paper) throw new NotFoundException('Exam paper not found');
    if (paper._count.results > 0) {
      throw new ConflictException(
        'Results have already been entered for this paper, so it cannot be removed',
      );
    }
    await this.prisma.examPaper.delete({ where: { id: paperId } });
    return { id: paperId };
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
