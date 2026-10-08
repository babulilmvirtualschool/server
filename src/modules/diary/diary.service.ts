import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EnrollmentStatus, Role } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { publicUserSelect } from '../../common/utils/public-user.select';
import { PrismaService } from '../../prisma/prisma.service';
import { DiaryRangeQueryDto, UpsertDiaryEntryDto } from './dto/diary.dto';

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
    return this.prisma.diaryEntry.findMany({
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
      include: entryInclude,
    });
  }

  /** Diary for a student's active sections on a day (all subjects). */
  private async forStudentProfile(studentId: string, day: string) {
    const enrollments = await this.prisma.studentEnrollment.findMany({
      where: { studentId, status: EnrollmentStatus.ACTIVE },
      select: { sectionId: true, academicYearId: true },
    });
    if (!enrollments.length) return [];
    return this.prisma.diaryEntry.findMany({
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
      include: entryInclude,
    });
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
}
