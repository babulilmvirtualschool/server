import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LiveClassPlatform, LiveClassStatus, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  CreateLiveClassDto,
  UpdateLiveClassDto,
} from './dto/live-class.dto';
import { publicUserSelect } from '../../common/utils/public-user.select';

/** Google Meet / Zoom from the link (PDF2 Teacher 1: both "Google Meet" & "Zoom"). */
function platformOf(link: string): LiveClassPlatform {
  const host = (() => {
    try {
      return new URL(link).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (host === 'meet.google.com') return LiveClassPlatform.GOOGLE_MEET;
  if (host === 'zoom.us' || host.endsWith('.zoom.us')) return LiveClassPlatform.ZOOM;
  return LiveClassPlatform.OTHER;
}

/** The chosen platform must match the link (a Zoom class needs a zoom.us link, Google Meet a meet.google.com link). */
function checkPlatform(link: string, platform?: LiveClassPlatform) {
  const found = platformOf(link);
  if (!platform || platform === LiveClassPlatform.OTHER) return platform ?? found;
  if (found !== platform) {
    const want = platform === LiveClassPlatform.ZOOM ? 'a Zoom link (zoom.us)' : 'a Google Meet link (meet.google.com)';
    throw new BadRequestException({ message: `Paste ${want}.`, fields: { meetingLink: `Paste ${want}` } });
  }
  return platform;
}

@Injectable()
export class LiveClassesService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertTeacherOfCourse(courseId: string, user: AuthUser) {
    if (user.role === Role.ADMIN) {
      const c = await this.prisma.course.findUnique({
        where: { id: courseId },
        include: { teacher: true },
      });
      if (!c) throw new NotFoundException('Course not found');
      return c.teacherId;
    }
    if (user.role !== Role.TEACHER) throw new ForbiddenException();
    const c = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: { teacher: true },
    });
    if (!c) throw new NotFoundException();
    if (c.teacher.userId !== user.id) {
      throw new ForbiddenException('Not the teacher of this course');
    }
    return c.teacherId;
  }

  async create(
    courseId: string,
    user: AuthUser,
    dto: CreateLiveClassDto,
  ) {
    const teacherId = await this.assertTeacherOfCourse(courseId, user);
    const start = new Date(dto.scheduledStart);
    const end = new Date(dto.scheduledEnd);
    if (end <= start) {
      throw new BadRequestException('scheduledEnd must be after scheduledStart');
    }
    return this.prisma.liveClass.create({
      data: {
        courseId,
        teacherId,
        title: dto.title,
        description: dto.description,
        meetingLink: dto.meetingLink,
        platform: checkPlatform(dto.meetingLink, dto.platform),
        scheduledStart: start,
        scheduledEnd: end,
        joinBufferMinutes: dto.joinBufferMinutes ?? 10,
      },
    });
  }

  listForCourse(courseId: string) {
    return this.prisma.liveClass.findMany({
      where: { courseId },
      orderBy: { scheduledStart: 'desc' },
    });
  }

  async upcoming(user: AuthUser) {
    if (user.role === Role.STUDENT) {
      const student = await this.prisma.studentProfile.findUnique({
        where: { userId: user.id },
        include: { enrollments: true },
      });
      if (!student) return [];
      const sectionIds = student.enrollments.map((e) => e.sectionId);
      const courses = await this.prisma.course.findMany({
        where: { sectionId: { in: sectionIds } },
        select: { id: true },
      });
      return this.prisma.liveClass.findMany({
        where: {
          courseId: { in: courses.map((c) => c.id) },
          scheduledEnd: { gte: new Date() },
          status: { in: [LiveClassStatus.SCHEDULED, LiveClassStatus.LIVE] },
        },
        include: {
          course: { include: { subject: true, section: true } },
        },
        orderBy: { scheduledStart: 'asc' },
      });
    }
    if (user.role === Role.TEACHER) {
      const t = await this.prisma.teacherProfile.findUnique({
        where: { userId: user.id },
      });
      if (!t) return [];
      return this.prisma.liveClass.findMany({
        where: {
          teacherId: t.id,
          scheduledEnd: { gte: new Date() },
        },
        include: { course: { include: { subject: true, section: true } } },
        orderBy: { scheduledStart: 'asc' },
      });
    }
    return [];
  }

  async update(id: string, user: AuthUser, dto: UpdateLiveClassDto) {
    const lc = await this.prisma.liveClass.findUnique({
      where: { id },
      include: { course: { include: { teacher: true } } },
    });
    if (!lc) throw new NotFoundException();
    if (
      user.role !== Role.ADMIN &&
      lc.course.teacher.userId !== user.id
    ) {
      throw new ForbiddenException();
    }
    const link = dto.meetingLink ?? lc.meetingLink;
    const platform = dto.meetingLink !== undefined || dto.platform !== undefined ? checkPlatform(link, dto.platform ?? (dto.meetingLink ? undefined : lc.platform)) : undefined;
    return this.prisma.liveClass.update({
      where: { id },
      data: {
        ...dto,
        ...(platform ? { platform } : {}),
        scheduledStart: dto.scheduledStart
          ? new Date(dto.scheduledStart)
          : undefined,
        scheduledEnd: dto.scheduledEnd ? new Date(dto.scheduledEnd) : undefined,
      },
    });
  }

  async cancel(id: string, user: AuthUser) {
    return this.update(id, user, { status: LiveClassStatus.CANCELLED });
  }

  /** Student clicks "Join": verify time window and record attendance. */
  async studentJoin(id: string, user: AuthUser) {
    if (user.role !== Role.STUDENT) throw new ForbiddenException();
    const lc = await this.prisma.liveClass.findUnique({
      where: { id },
      include: { course: true },
    });
    if (!lc) throw new NotFoundException();
    if (lc.status === LiveClassStatus.CANCELLED) {
      throw new BadRequestException('This class has been cancelled');
    }

    const now = new Date();
    const openAt = new Date(
      lc.scheduledStart.getTime() - lc.joinBufferMinutes * 60_000,
    );
    if (now < openAt) {
      throw new BadRequestException(
        `Join is not yet available. Opens at ${openAt.toISOString()}`,
      );
    }
    if (now > lc.scheduledEnd) {
      throw new BadRequestException('This class has ended');
    }

    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: user.id },
      include: { enrollments: true },
    });
    if (!student) throw new ForbiddenException('Student profile not found');
    const enrolled = student.enrollments.some(
      (e) => e.sectionId === lc.course.sectionId,
    );
    if (!enrolled) {
      throw new ForbiddenException('Not enrolled in this course');
    }

    await this.prisma.liveClassAttendance.upsert({
      where: {
        liveClassId_studentId: { liveClassId: lc.id, studentId: student.id },
      },
      update: {},
      create: { liveClassId: lc.id, studentId: student.id },
    });
    return { meetingLink: lc.meetingLink };
  }

  attendance(id: string) {
    return this.prisma.liveClassAttendance.findMany({
      where: { liveClassId: id },
      include: { student: { include: { user: { select: publicUserSelect } } } },
    });
  }
}
