import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateExamDto,
  CreateExamPaperDto,
  RecordExamResultDto,
  UpdateExamDto,
} from './dto/exam.dto';

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
          include: {
            course: {
              include: { subject: true, section: { include: { class: true } } },
            },
            quiz: true,
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

  createPaper(examId: string, dto: CreateExamPaperDto) {
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
      include: { student: { include: { user: true } } },
    });
  }
}
