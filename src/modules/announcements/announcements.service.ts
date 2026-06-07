import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AnnouncementAudience, Role } from '@prisma/client';
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
    if (user.role === Role.TEACHER) {
      // Teachers can only post to their own course/section.
      if (dto.audience === AnnouncementAudience.COURSE && dto.courseId) {
        const c = await this.prisma.course.findUnique({
          where: { id: dto.courseId },
          include: { teacher: true },
        });
        if (!c || c.teacher.userId !== user.id) throw new ForbiddenException();
      } else if (dto.audience === AnnouncementAudience.SECTION && dto.sectionId) {
        const s = await this.prisma.section.findUnique({
          where: { id: dto.sectionId },
          include: { classTeacher: true },
        });
        if (!s || s.classTeacher?.userId !== user.id) {
          throw new ForbiddenException();
        }
      } else {
        throw new ForbiddenException(
          'Teachers can only post to their own course or section',
        );
      }
    }
    return this.prisma.announcement.create({
      data: {
        title: dto.title,
        body: dto.body,
        audience: dto.audience,
        sectionId: dto.sectionId,
        courseId: dto.courseId,
        authorId: user.id,
        attachments: dto.attachments as any,
      },
    });
  }

  /** Build a where clause for announcements visible to the given user. */
  private async visibilityWhere(user: AuthUser) {
    const baseOr: any[] = [{ audience: AnnouncementAudience.ALL }];

    if (user.role === Role.ADMIN) {
      baseOr.push({ audience: AnnouncementAudience.ADMINS });
    }
    if (user.role === Role.TEACHER) {
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
          sectionId: { in: t.homeroomSections.map((s) => s.id) },
        });
      }
    }
    if (user.role === Role.STUDENT) {
      baseOr.push({ audience: AnnouncementAudience.STUDENTS });
      const s = await this.prisma.studentProfile.findUnique({
        where: { userId: user.id },
        include: { enrollments: true },
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
          children: { include: { student: { include: { enrollments: true } } } },
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
    return this.prisma.announcement.update({
      where: { id },
      data: {
        ...dto,
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
