import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EnrollmentStatus, MediaPurpose, Prisma, Role } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { ownUploads } from '../../common/utils/own-uploads';
import { publicUserSelect } from '../../common/utils/public-user.select';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CheckDiaryHomeworkDto,
  DiaryRangeQueryDto,
  MyDiaryHomeworkQueryDto,
  SubmitDiaryHomeworkDto,
  UpsertDiaryEntryDto,
} from './dto/diary.dto';

/** `YYYY-MM-DD` → UTC midnight, so `@db.Date` stores exactly that day regardless of server timezone. */
function parseDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

const entryInclude = {
  course: {
    include: {
      subject: true,
      section: { include: { class: true } },
      teacher: { include: { user: { select: publicUserSelect } } },
    },
  },
  author: { select: { id: true, firstName: true, lastName: true } },
} as const;

@Injectable()
export class DiaryService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertCourseTeacher(courseId: string, user: AuthUser) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: { teacher: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (user.role === Role.ADMIN) return;
    if (user.role !== Role.TEACHER || course.teacher.userId !== user.id) {
      throw new ForbiddenException('Not the teacher of this course');
    }
  }

  /** Teacher (own course) / admin — create or replace the diary for a course on a day. */
  async upsert(user: AuthUser, dto: UpsertDiaryEntryDto) {
    await this.assertCourseTeacher(dto.courseId, user);
    const content = dto.content.trim();
    if (!content) throw new BadRequestException('Diary text is required');
    const date = parseDay(dto.date);
    return this.prisma.diaryEntry.upsert({
      where: { courseId_date: { courseId: dto.courseId, date } },
      create: { courseId: dto.courseId, date, content, authorId: user.id },
      update: { content, authorId: user.id },
      include: entryInclude,
    });
  }

  async remove(user: AuthUser, id: string) {
    const entry = await this.prisma.diaryEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Diary entry not found');
    await this.assertCourseTeacher(entry.courseId, user);
    await this.prisma.diaryEntry.delete({ where: { id } });
    return { id };
  }

  /** Teacher (own course) / admin — entries for one course, newest first (max 60). */
  async listForCourse(user: AuthUser, courseId: string, q: DiaryRangeQueryDto) {
    await this.assertCourseTeacher(courseId, user);
    const rows = await this.prisma.diaryEntry.findMany({
      where: {
        courseId,
        ...(q.from || q.to
          ? {
              date: {
                ...(q.from ? { gte: parseDay(q.from) } : {}),
                ...(q.to ? { lte: parseDay(q.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { date: 'desc' },
      take: 60,
      include: { ...entryInclude, submissions: { select: { checked: true } } },
    });
    // Homework handed in for each day's diary, and how many the teacher has checked.
    return rows.map(({ submissions, ...e }) => ({
      ...e,
      homework: { submitted: submissions.length, checked: submissions.filter((x) => x.checked).length },
    }));
  }

  /** Diary for a student's active sections on a day (all subjects). */
  private async forStudentProfile(studentId: string, day: string) {
    const enrollments = await this.prisma.studentEnrollment.findMany({
      where: { studentId, status: EnrollmentStatus.ACTIVE },
      select: { sectionId: true, academicYearId: true },
    });
    if (!enrollments.length) return [];
    const rows = await this.prisma.diaryEntry.findMany({
      where: {
        date: parseDay(day),
        course: {
          isActive: true,
          OR: enrollments.map((e) => ({
            sectionId: e.sectionId,
            academicYearId: e.academicYearId,
          })),
        },
      },
      orderBy: { course: { subject: { name: 'asc' } } },
      include: { ...entryInclude, submissions: { where: { studentId } } },
    });
    return rows.map(({ submissions, ...e }) => ({ ...e, mySubmission: submissions[0] ?? null }));
  }

  async forStudentUser(user: AuthUser, day: string) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
    });
    if (!student) throw new ForbiddenException('Student profile not found');
    return this.forStudentProfile(student.id, day);
  }

  async forChild(user: AuthUser, studentId: string, day: string) {
    const parent = await this.prisma.parentProfile.findUnique({
      where: { userId: user.id },
    });
    if (!parent) throw new ForbiddenException();
    const link = await this.prisma.parentStudentLink.findFirst({
      where: { parentId: parent.id, studentId },
    });
    if (!link) throw new ForbiddenException('Not a parent of this student');
    return this.forStudentProfile(studentId, day);
  }

  // ---------- homework (PDF2 Student 1 / Teacher 8) ----------

  /** Student — hand in (or replace, until checked) homework for a diary entry of one of their classes. */
  async submitHomework(user: AuthUser, entryId: string, dto: SubmitDiaryHomeworkDto) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { id: true, enrollments: { where: { status: EnrollmentStatus.ACTIVE }, select: { sectionId: true } } },
    });
    if (!student) throw new ForbiddenException('Student profile not found');
    const entry = await this.prisma.diaryEntry.findUnique({ where: { id: entryId }, include: { course: { select: { sectionId: true } } } });
    if (!entry || !student.enrollments.some((e) => e.sectionId === entry.course.sectionId)) {
      throw new NotFoundException('Diary entry not found');
    }
    const key = { diaryEntryId_studentId: { diaryEntryId: entryId, studentId: student.id } };
    const existing = await this.prisma.diarySubmission.findUnique({ where: key });
    if (existing?.checked) throw new BadRequestException('The teacher has already checked this homework.');
    const files = dto.attachments !== undefined ? await ownUploads(this.prisma, user, dto.attachments, MediaPurpose.ASSIGNMENT_SUBMISSION) : undefined;
    const text = dto.text !== undefined ? dto.text.trim() || null : (existing?.text ?? null);
    const finalFiles = files ?? ((existing?.attachments as unknown[] | null) ?? []);
    if (!text && !finalFiles.length) throw new BadRequestException('Write your work or attach at least one file.');
    const data = { text, ...(files !== undefined ? { attachments: files as unknown as Prisma.InputJsonValue } : {}), submittedAt: new Date() };
    return this.prisma.diarySubmission.upsert({
      where: key,
      update: data,
      create: { diaryEntryId: entryId, studentId: student.id, ...data },
    });
  }

  /** Teacher (own course) / admin — every student of the class with their homework for this diary entry. */
  async homeworkRoster(user: AuthUser, entryId: string) {
    const entry = await this.prisma.diaryEntry.findUnique({ where: { id: entryId }, include: entryInclude });
    if (!entry) throw new NotFoundException('Diary entry not found');
    await this.assertCourseTeacher(entry.courseId, user);
    const [enrolled, submissions] = await Promise.all([
      this.prisma.studentEnrollment.findMany({
        where: { sectionId: entry.course.sectionId, status: EnrollmentStatus.ACTIVE },
        select: { rollNumber: true, student: { select: { id: true, user: { select: { firstName: true, lastName: true } } } } },
      }),
      this.prisma.diarySubmission.findMany({ where: { diaryEntryId: entryId } }),
    ]);
    const rows = enrolled
      .map((e) => ({
        student: { id: e.student.id, name: `${e.student.user.firstName} ${e.student.user.lastName}`.trim(), rollNumber: e.rollNumber },
        submission: submissions.find((x) => x.studentId === e.student.id) ?? null,
      }))
      .sort(
        (a, b) =>
          (a.student.rollNumber ?? '').localeCompare(b.student.rollNumber ?? '', undefined, { numeric: true }) ||
          a.student.name.localeCompare(b.student.name),
      );
    return {
      entry,
      rows,
      counts: { students: rows.length, submitted: submissions.length, checked: submissions.filter((x) => x.checked).length },
    };
  }

  /** Teacher (own course) / admin — diary checked, grade / digital stars and remarks. */
  async checkHomework(user: AuthUser, submissionId: string, dto: CheckDiaryHomeworkDto) {
    const sub = await this.prisma.diarySubmission.findUnique({
      where: { id: submissionId },
      include: { diaryEntry: { select: { courseId: true } } },
    });
    if (!sub) throw new NotFoundException('Homework not found');
    await this.assertCourseTeacher(sub.diaryEntry.courseId, user);
    const checked = dto.checked ?? true;
    return this.prisma.diarySubmission.update({
      where: { id: submissionId },
      data: {
        checked,
        checkedAt: checked ? new Date() : null,
        checkedById: checked ? user.id : null,
        ...(dto.grade !== undefined ? { grade: dto.grade.trim() || null } : {}),
        ...(dto.stars !== undefined ? { stars: dto.stars } : {}),
        ...(dto.remarks !== undefined ? { remarks: dto.remarks.trim() || null } : {}),
      },
    });
  }

  /** Student — own homework by date and subject with the teacher's grade and remarks. */
  async myHomework(user: AuthUser, q: MyDiaryHomeworkQueryDto) {
    const student = await this.prisma.studentProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!student) throw new ForbiddenException('Student profile not found');
    const rows = await this.prisma.diarySubmission.findMany({
      where: {
        studentId: student.id,
        ...(q.from || q.to
          ? { diaryEntry: { date: { ...(q.from ? { gte: parseDay(q.from) } : {}), ...(q.to ? { lte: parseDay(q.to) } : {}) } } }
          : {}),
      },
      include: {
        diaryEntry: { select: { id: true, date: true, content: true, course: { select: { id: true, subject: { select: { name: true } } } } } },
      },
      orderBy: { diaryEntry: { date: 'desc' } },
      take: 300,
    });
    return rows.map(({ diaryEntry, ...x }) => ({
      ...x,
      date: diaryEntry.date.toISOString().slice(0, 10),
      subject: diaryEntry.course.subject.name,
      courseId: diaryEntry.course.id,
      diary: diaryEntry.content,
    }));
  }
}
