import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EnrollmentStatus, MediaPurpose, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AttachmentDto,
  CreateAssignmentDto,
  GradeSubmissionDto,
  MyAssignmentsQueryDto,
  SubmitAssignmentDto,
  UpdateAssignmentDto,
} from './dto/assignment.dto';
import { ownUploads } from '../../common/utils/own-uploads';
import { publicUserSelect } from '../../common/utils/public-user.select';

const utcDay = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00.000Z`);
const name = (u?: { firstName: string; lastName: string } | null) => (u ? `${u.firstName} ${u.lastName}`.trim() : '');

const courseLabelSelect = {
  id: true,
  sectionId: true,
  subject: { select: { id: true, name: true } },
  section: { select: { id: true, name: true, class: { select: { name: true } } } },
} as const;

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

  private ownFiles(user: AuthUser, files: AttachmentDto[], purpose: MediaPurpose) {
    return ownUploads(this.prisma, user, files, purpose);
  }

  async create(courseId: string, user: AuthUser, dto: CreateAssignmentDto) {
    await this.assertCourseTeacher(courseId, user);
    const attachments = dto.attachments?.length
      ? await this.ownFiles(user, dto.attachments, MediaPurpose.ASSIGNMENT_ATTACHMENT)
      : null;
    const published = dto.isPublished ?? true;
    return this.prisma.assignment.create({
      data: {
        courseId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        lessonId: dto.lessonId,
        topicId: dto.topicId,
        maxMarks: dto.maxMarks,
        dueDate: new Date(dto.dueDate),
        allowLate: dto.allowLate ?? true,
        isPublished: published,
        publishedAt: published ? new Date() : null,
        attachments: attachments ? (attachments as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  }

  /** Students only see published assignments. */
  listForCourse(courseId: string, user: AuthUser) {
    return this.prisma.assignment.findMany({
      where: { courseId, ...(user.role === Role.STUDENT || user.role === Role.PARENT ? { isPublished: true } : {}) },
      orderBy: { dueDate: 'asc' },
      include: { _count: { select: { submissions: true } } },
    });
  }

  async get(id: string, user: AuthUser) {
    const a = await this.prisma.assignment.findUnique({
      where: { id },
      include: { course: { include: { subject: true, section: true } } },
    });
    if (!a || (!a.isPublished && (user.role === Role.STUDENT || user.role === Role.PARENT))) throw new NotFoundException();
    return a;
  }

  /** Teacher (own courses) / admin (all): assignments with class, subject and submission counts. */
  async listMine(user: AuthUser, q: MyAssignmentsQueryDto) {
    if (user.role !== Role.ADMIN && user.role !== Role.TEACHER) throw new ForbiddenException();
    const rows = await this.prisma.assignment.findMany({
      where: {
        ...(q.courseId ? { courseId: q.courseId } : {}),
        ...(q.status ? { isPublished: q.status === 'PUBLISHED' } : {}),
        ...(q.createdFrom || q.createdTo
          ? { createdAt: { ...(q.createdFrom ? { gte: utcDay(q.createdFrom) } : {}), ...(q.createdTo ? { lt: new Date(utcDay(q.createdTo).getTime() + 86_400_000) } : {}) } }
          : {}),
        ...(q.dueFrom || q.dueTo
          ? { dueDate: { ...(q.dueFrom ? { gte: utcDay(q.dueFrom) } : {}), ...(q.dueTo ? { lt: new Date(utcDay(q.dueTo).getTime() + 86_400_000) } : {}) } }
          : {}),
        course: {
          ...(user.role === Role.TEACHER ? { teacher: { userId: user.id } } : {}),
          ...(q.sectionId ? { sectionId: q.sectionId } : {}),
          ...(q.subjectId ? { subjectId: q.subjectId } : {}),
        },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
      include: {
        course: { select: courseLabelSelect },
        submissions: { select: { isLate: true, grade: { select: { id: true } } } },
      },
    });
    const sectionIds = [...new Set(rows.map((r) => r.course.sectionId))];
    const counts = sectionIds.length
      ? await this.prisma.studentEnrollment.groupBy({
          by: ['sectionId'],
          where: { sectionId: { in: sectionIds }, status: EnrollmentStatus.ACTIVE },
          _count: { _all: true },
        })
      : [];
    return rows.map(({ submissions, course, ...a }) => ({
      ...a,
      course: { id: course.id, subject: course.subject, section: course.section },
      counts: {
        students: counts.find((c) => c.sectionId === course.sectionId)?._count._all ?? 0,
        submitted: submissions.length,
        late: submissions.filter((s) => s.isLate).length,
        graded: submissions.filter((s) => s.grade).length,
      },
    }));
  }

  async update(id: string, user: AuthUser, dto: UpdateAssignmentDto) {
    const a = await this.prisma.assignment.findUnique({ where: { id } });
    if (!a) throw new NotFoundException();
    await this.assertCourseTeacher(a.courseId, user);
    let attachments: Prisma.InputJsonValue | undefined;
    if (dto.attachments !== undefined) {
      // Files already on the assignment stay valid; new ones must be the caller's own uploads.
      const old = ((a.attachments ?? []) as unknown as { key: string }[]).map((f) => f.key);
      const fresh = dto.attachments.filter((f) => !old.includes(f.key));
      const kept = ((a.attachments ?? []) as unknown as AttachmentDto[]).filter((f) => dto.attachments!.some((d) => d.key === f.key));
      const added = fresh.length ? await this.ownFiles(user, fresh, MediaPurpose.ASSIGNMENT_ATTACHMENT) : [];
      attachments = [...kept, ...added] as unknown as Prisma.InputJsonValue;
    }
    const { attachments: _a, ...rest } = dto;
    return this.prisma.assignment.update({
      where: { id },
      data: {
        ...rest,
        ...(rest.title !== undefined ? { title: rest.title.trim() } : {}),
        ...(rest.description !== undefined ? { description: rest.description?.trim() || null } : {}),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        ...(dto.isPublished === true && !a.isPublished ? { publishedAt: new Date() } : {}),
        ...(attachments !== undefined ? { attachments } : {}),
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
    if (!assignment || !assignment.isPublished) throw new NotFoundException();

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

    const attachments =
      dto.attachments !== undefined
        ? ((await this.ownFiles(user, dto.attachments, MediaPurpose.ASSIGNMENT_SUBMISSION)) as unknown as Prisma.InputJsonValue)
        : undefined;

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

  /**
   * Every student actively enrolled in the class, with their submission: on time, late, or not submitted
   * (PDF2 Teacher 2 "Assignment received after completion (due date or after due date)").
   */
  async roster(assignmentId: string, user: AuthUser) {
    const a = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { course: { select: courseLabelSelect } },
    });
    if (!a) throw new NotFoundException();
    await this.assertCourseTeacher(a.courseId, user);
    const [enrolled, submissions] = await Promise.all([
      this.prisma.studentEnrollment.findMany({
        where: { sectionId: a.course.sectionId, status: EnrollmentStatus.ACTIVE },
        select: { rollNumber: true, student: { select: { id: true, user: { select: { firstName: true, lastName: true, avatarKey: true } } } } },
      }),
      this.prisma.assignmentSubmission.findMany({ where: { assignmentId }, include: { grade: true } }),
    ]);
    const rows = enrolled
      .map((e) => {
        const sub = submissions.find((s) => s.studentId === e.student.id) ?? null;
        return {
          student: { id: e.student.id, name: name(e.student.user), rollNumber: e.rollNumber, avatarKey: e.student.user.avatarKey },
          status: sub ? (sub.isLate ? 'LATE' : 'ON_TIME') : 'MISSING',
          submission: sub,
        };
      })
      .sort((x, y) => (x.student.rollNumber ?? '').localeCompare(y.student.rollNumber ?? '', undefined, { numeric: true }) || x.student.name.localeCompare(y.student.name));
    const { course, ...assignment } = a;
    return {
      assignment: { ...assignment, course: { id: course.id, subject: course.subject, section: course.section } },
      rows,
      counts: {
        students: rows.length,
        onTime: rows.filter((r) => r.status === 'ON_TIME').length,
        late: rows.filter((r) => r.status === 'LATE').length,
        missing: rows.filter((r) => r.status === 'MISSING').length,
        graded: rows.filter((r) => r.submission?.grade).length,
      },
    };
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

  /** Marks (≤ max marks), digital stars (1–5) and / or an emoji, plus optional feedback. */
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
    if (dto.marksObtained == null && dto.stars == null && !dto.emoji) {
      throw new BadRequestException({ message: 'Give marks, stars or an emoji.', fields: { marksObtained: 'Give marks, stars or an emoji' } });
    }
    if (dto.marksObtained != null && dto.marksObtained > sub.assignment.maxMarks) {
      throw new BadRequestException({
        message: `Marks can't be more than ${sub.assignment.maxMarks}.`,
        fields: { marksObtained: `At most ${sub.assignment.maxMarks}` },
      });
    }
    const data = {
      marksObtained: dto.marksObtained ?? null,
      stars: dto.stars ?? null,
      emoji: dto.emoji ?? null,
      feedback: dto.feedback?.trim() || null,
      gradedById: user.id,
    };
    return this.prisma.assignmentGrade.upsert({
      where: { submissionId },
      update: { ...data, gradedAt: new Date() },
      create: { submissionId, ...data },
    });
  }
}
