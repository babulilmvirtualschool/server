import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  CreateAssignmentDto,
  GradeSubmissionDto,
  SubmitAssignmentDto,
  UpdateAssignmentDto,
} from './dto/assignment.dto';

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

    return this.prisma.assignmentSubmission.upsert({
      where: {
        assignmentId_studentId: {
          assignmentId,
          studentId: student.id,
        },
      },
      update: {
        textAnswer: dto.textAnswer,
        attachments:
          dto.attachments === undefined
            ? undefined
            : (dto.attachments as unknown as Prisma.InputJsonValue),
        submittedAt: now,
        isLate,
      },
      create: {
        assignmentId,
        studentId: student.id,
        textAnswer: dto.textAnswer,
        attachments:
          dto.attachments === undefined
            ? undefined
            : (dto.attachments as unknown as Prisma.InputJsonValue),
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
        student: { include: { user: true } },
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
