import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AnnouncementAudience, EnrollmentStatus, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
} from './dto/announcement.dto';

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: AuthUser, dto: CreateAnnouncementDto) {
    if (user.role !== Role.ADMIN && user.role !== Role.TEACHER) {
      throw new ForbiddenException();
    }
    await this.checkTarget(user, dto.audience, dto.sectionId, dto.courseId);
    return this.prisma.announcement.create({
      data: {
        title: dto.title,
        body: dto.body,
        audience: dto.audience,
        sectionId: dto.audience === AnnouncementAudience.SECTION ? dto.sectionId : null,
        courseId: dto.audience === AnnouncementAudience.COURSE ? dto.courseId : null,
        authorId: user.id,
        attachments: dto.attachments as any,
      },
    });
  }

  /** A class or course post needs its target; teachers can only post to a course they teach or the class they are class teacher of. */
  private async checkTarget(
    user: AuthUser,
    audience: AnnouncementAudience,
    sectionId?: string | null,
    courseId?: string | null,
  ) {
    const isTeacher = user.role === Role.TEACHER;
    if (audience === AnnouncementAudience.COURSE) {
      if (!courseId) throw new BadRequestException('Choose the course');
      const c = await this.prisma.course.findUnique({
        where: { id: courseId },
        select: { teacher: { select: { userId: true } } },
      });
      if (!c) throw new NotFoundException('Course not found');
      if (isTeacher && c.teacher.userId !== user.id) throw new ForbiddenException('You can only post to a course you teach');
    } else if (audience === AnnouncementAudience.SECTION) {
      if (!sectionId) throw new BadRequestException('Choose the class');
      const s = await this.prisma.section.findUnique({
        where: { id: sectionId },
        select: { classTeacher: { select: { userId: true } } },
      });
      if (!s) throw new NotFoundException('Class not found');
      if (isTeacher && s.classTeacher?.userId !== user.id) throw new ForbiddenException('You can only post to the class you are class teacher of');
    } else if (isTeacher) {
      throw new ForbiddenException('Teachers can only post to their own course or section');
    }
  }

  /** Classes and courses of the current year this user can post to. */
  async targets(user: AuthUser) {
    const isTeacher = user.role === Role.TEACHER;
    const [sections, courses] = await Promise.all([
      this.prisma.section.findMany({
        where: {
          class: { academicYear: { isCurrent: true } },
          ...(isTeacher ? { classTeacher: { userId: user.id } } : {}),
        },
        select: { id: true, name: true, class: { select: { name: true, level: true } } },
        orderBy: [{ class: { level: 'asc' } }, { name: 'asc' }],
      }),
      this.prisma.course.findMany({
        where: {
          academicYear: { isCurrent: true },
          isActive: true,
          ...(isTeacher ? { teacher: { userId: user.id } } : {}),
        },
        select: {
          id: true,
          subject: { select: { name: true } },
          section: { select: { name: true, class: { select: { name: true, level: true } } } },
        },
        orderBy: [{ section: { class: { level: 'asc' } } }, { section: { name: 'asc' } }, { subject: { name: 'asc' } }],
      }),
    ]);
    return { sections, courses };
  }

  /** Build a where clause for announcements visible to the given user. */
  private async visibilityWhere(user: AuthUser) {
    // The admin manages every announcement of the school, whoever it was sent to.
    if (user.role === Role.ADMIN) return {};
    const baseOr: any[] = [{ audience: AnnouncementAudience.ALL }];
    const currentEnrollments = {
      where: { status: EnrollmentStatus.ACTIVE, academicYear: { isCurrent: true } },
    };

    // Non-teaching staff have a teacher profile too and read the same "teachers & staff" posts.
    if (user.role === Role.TEACHER || user.role === Role.STAFF) {
      baseOr.push({ audience: AnnouncementAudience.TEACHERS });
      const t = await this.prisma.teacherProfile.findUnique({
        where: { userId: user.id },
        include: { coursesTaught: true, homeroomSections: true },
      });
      if (t) {
        baseOr.push({
          audience: AnnouncementAudience.COURSE,
          courseId: { in: t.coursesTaught.map((c) => c.id) },
        });
        baseOr.push({
          audience: AnnouncementAudience.SECTION,
          sectionId: { in: [...t.homeroomSections.map((s) => s.id), ...t.coursesTaught.map((c) => c.sectionId)] },
        });
      }
    }
    if (user.role === Role.STUDENT) {
      baseOr.push({ audience: AnnouncementAudience.STUDENTS });
      const s = await this.prisma.studentProfile.findUnique({
        where: { userId: user.id },
        include: { enrollments: currentEnrollments },
      });
      if (s) {
        const sectionIds = s.enrollments.map((e) => e.sectionId);
        baseOr.push({
          audience: AnnouncementAudience.SECTION,
          sectionId: { in: sectionIds },
        });
        const courses = await this.prisma.course.findMany({
          where: { sectionId: { in: sectionIds } },
          select: { id: true },
        });
        baseOr.push({
          audience: AnnouncementAudience.COURSE,
          courseId: { in: courses.map((c) => c.id) },
        });
      }
    }
    if (user.role === Role.PARENT) {
      baseOr.push({ audience: AnnouncementAudience.PARENTS });
      const p = await this.prisma.parentProfile.findUnique({
        where: { userId: user.id },
        include: {
          children: { include: { student: { include: { enrollments: currentEnrollments } } } },
        },
      });
      if (p) {
        const sectionIds = p.children.flatMap((c) =>
          c.student.enrollments.map((e) => e.sectionId),
        );
        baseOr.push({
          audience: AnnouncementAudience.SECTION,
          sectionId: { in: sectionIds },
        });
      }
    }
    return { OR: baseOr };
  }

  async listVisible(user: AuthUser) {
    const where = await this.visibilityWhere(user);
    return this.prisma.announcement.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      include: {
        author: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
        section: { select: { name: true, class: { select: { name: true } } } },
        course: {
          select: {
            subject: { select: { name: true } },
            section: { select: { name: true, class: { select: { name: true } } } },
          },
        },
      },
    });
  }

  async update(id: string, user: AuthUser, dto: UpdateAnnouncementDto) {
    const existing = await this.prisma.announcement.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException();
    if (user.role !== Role.ADMIN && existing.authorId !== user.id) {
      throw new ForbiddenException();
    }
    const audience = dto.audience ?? existing.audience;
    const sectionId = audience === AnnouncementAudience.SECTION ? (dto.sectionId ?? existing.sectionId) : null;
    const courseId = audience === AnnouncementAudience.COURSE ? (dto.courseId ?? existing.courseId) : null;
    // Only a changed target is checked: a teacher can still correct the text of a post to a course that has since moved to someone else.
    if (audience !== existing.audience || sectionId !== existing.sectionId || courseId !== existing.courseId) {
      await this.checkTarget(user, audience, sectionId, courseId);
    }
    return this.prisma.announcement.update({
      where: { id },
      data: {
        ...dto,
        sectionId,
        courseId,
        attachments: dto.attachments as any,
      },
    });
  }

  async delete(id: string, user: AuthUser) {
    const existing = await this.prisma.announcement.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException();
    if (user.role !== Role.ADMIN && existing.authorId !== user.id) {
      throw new ForbiddenException();
    }
    return this.prisma.announcement.delete({ where: { id } });
  }
}
