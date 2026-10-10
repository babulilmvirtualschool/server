import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MediaPurpose, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  CreateAssignmentDto,
  GradeSubmissionDto,
  SubmitAssignmentDto,
  UpdateAssignmentDto,
} from './dto/assignment.dto';
import { publicUserSelect } from '../../common/utils/public-user.select';

@Injectable()
export class AssignmentsService {
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

  async create(courseId: string, user: AuthUser, dto: CreateAssignmentDto) {
    await this.assertCourseTeacher(courseId, user);
    return this.prisma.assignment.create({
      data: {
        courseId,
        title: dto.title,
        description: dto.description,
        lessonId: dto.lessonId,
        topicId: dto.topicId,
        maxMarks: dto.maxMarks,
        dueDate: new Date(dto.dueDate),
        allowLate: dto.allowLate ?? true,
        attachments: dto.attachments
          ? (dto.attachments as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });
  }

  listForCourse(courseId: string) {
    return this.prisma.assignment.findMany({
      where: { courseId },
      orderBy: { dueDate: 'asc' },
      include: { _count: { select: { submissions: true } } },
    });
  }

  async get(id: string) {
    const a = await this.prisma.assignment.findUnique({
      where: { id },
      include: { course: { include: { subject: true, section: true } } },
    });
    if (!a) throw new NotFoundException();
    return a;
  }

  async update(id: string, user: AuthUser, dto: UpdateAssignmentDto) {
    const a = await this.prisma.assignment.findUnique({ where: { id } });
    if (!a) throw new NotFoundException();
    await this.assertCourseTeacher(a.courseId, user);
    return this.prisma.assignment.update({
      where: { id },
      data: {
        ...dto,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        attachments:
          dto.attachments === undefined
            ? undefined
            : (dto.attachments as unknown as Prisma.InputJsonValue),
      },
    });
  }

  async delete(id: string, user: AuthUser) {
    const a = await this.prisma.assignment.findUnique({ where: { id } });
    if (!a) throw new NotFoundException();
    await this.assertCourseTeacher(a.courseId, user);
    return this.prisma.assignment.delete({ where: { id } });
  }

  // -------- Submissions --------
  async submit(
    assignmentId: string,
    user: AuthUser,
    dto: SubmitAssignmentDto,
  ) {
    if (user.role !== Role.STUDENT) throw new ForbiddenException();
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { course: true },
    });
    if (!assignment) throw new NotFoundException();

    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      include: { enrollments: true },
    });
    if (!student) throw new ForbiddenException();
    const enrolled = student.enrollments.some(
      (e) => e.sectionId === assignment.course.sectionId,
    );
    if (!enrolled) throw new ForbiddenException('Not enrolled in this course');

    const now = new Date();
    const isLate = now > assignment.dueDate;
    if (isLate && !assignment.allowLate) {
      throw new BadRequestException('Late submissions are not allowed');
    }

    const existing = await this.prisma.assignmentSubmission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId: student.id } },
      include: { grade: true },
    });
    if (existing?.grade) {
      throw new BadRequestException(
        'This submission has already been graded and can no longer be changed',
      );
    }

    // Files must be the student's own finished uploads for assignment submissions;
    // name/size/type are taken from the upload record, not from the request.
    let attachments: Prisma.InputJsonValue | undefined;
    if (dto.attachments !== undefined) {
      const keys = dto.attachments.map((a) => a.key);
      if (new Set(keys).size !== keys.length) {
        throw new BadRequestException('The same file is attached twice');
      }
      const assets = await this.prisma.mediaAsset.findMany({
        where: { key: { in: keys } },
      });
      const valid = (key: string) => {
        const m = assets.find((x) => x.key === key);
        return (
          !!m &&
          m.uploaderId === user.id &&
          m.finalized &&
          m.purpose === MediaPurpose.ASSIGNMENT_SUBMISSION
        );
      };
      if (!keys.every(valid)) {
        throw new BadRequestException(
          'One or more files were not uploaded by you for this submission',
        );
      }
      attachments = dto.attachments.map((a) => {
        const m = assets.find((x) => x.key === a.key)!;
        return { key: a.key, name: m.originalName ?? a.name, size: m.size, mime: m.mimeType };
      });
    }

    const textAnswer =
      dto.textAnswer !== undefined
        ? dto.textAnswer.trim() || null
        : (existing?.textAnswer ?? null);
    const finalFiles =
      attachments !== undefined
        ? (attachments as unknown[])
        : ((existing?.attachments as unknown[] | null) ?? []);
    if (!textAnswer && !finalFiles.length) {
      throw new BadRequestException('Write an answer or attach at least one file');
    }

    return this.prisma.assignmentSubmission.upsert({
      where: {
        assignmentId_studentId: {
          assignmentId,
          studentId: student.id,
        },
      },
      update: {
        textAnswer,
        ...(attachments !== undefined ? { attachments } : {}),
        submittedAt: now,
        isLate,
      },
      create: {
        assignmentId,
        studentId: student.id,
        textAnswer,
        ...(attachments !== undefined ? { attachments } : {}),
        isLate,
      },
    });
  }

  async listSubmissions(assignmentId: string, user: AuthUser) {
    const a = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
    });
    if (!a) throw new NotFoundException();
    await this.assertCourseTeacher(a.courseId, user);
    return this.prisma.assignmentSubmission.findMany({
      where: { assignmentId },
      include: {
        student: { include: { user: { select: publicUserSelect } } },
        grade: true,
      },
      orderBy: { submittedAt: 'desc' },
    });
  }

  async mySubmission(assignmentId: string, user: AuthUser) {
    if (user.role !== Role.STUDENT) throw new ForbiddenException();
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
    });
    if (!student) return null;
    return this.prisma.assignmentSubmission.findUnique({
      where: {
        assignmentId_studentId: {
          assignmentId,
          studentId: student.id,
        },
      },
      include: { grade: true },
    });
  }

  async grade(
    submissionId: string,
    user: AuthUser,
    dto: GradeSubmissionDto,
  ) {
    const sub = await this.prisma.assignmentSubmission.findUnique({
      where: { id: submissionId },
      include: { assignment: true },
    });
    if (!sub) throw new NotFoundException();
    await this.assertCourseTeacher(sub.assignment.courseId, user);
    if (dto.marksObtained > sub.assignment.maxMarks) {
      throw new BadRequestException(
        `marksObtained exceeds maxMarks (${sub.assignment.maxMarks})`,
      );
    }
    return this.prisma.assignmentGrade.upsert({
      where: { submissionId },
      update: {
        marksObtained: dto.marksObtained,
        feedback: dto.feedback,
        gradedById: user.id,
        gradedAt: new Date(),
      },
      create: {
        submissionId,
        marksObtained: dto.marksObtained,
        feedback: dto.feedback,
        gradedById: user.id,
      },
    });
  }
}
