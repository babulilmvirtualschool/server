import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContentType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateLessonDto, UpdateLessonDto } from './dto/lesson.dto';
import { CreateTopicDto, UpdateTopicDto } from './dto/topic.dto';
import {
  CreateContentItemDto,
  UpdateContentItemDto,
} from './dto/content-item.dto';
import { UpsertSyllabusDto } from './dto/syllabus.dto';
import { extractYouTubeId } from './youtube.util';

@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ensures the user is the teacher of the course (or admin). */
  private async assertCourseTeacher(courseId: string, user: AuthUser) {
    if (user.role === 'ADMIN') return;
    if (user.role !== 'TEACHER') throw new ForbiddenException();
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: { teacher: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.teacher.userId !== user.id) {
      throw new ForbiddenException('Not the teacher of this course');
    }
  }

  // -------- Lessons --------
  async createLesson(courseId: string, user: AuthUser, dto: CreateLessonDto) {
    await this.assertCourseTeacher(courseId, user);
    return this.prisma.lesson.create({ data: { ...dto, courseId } });
  }

  listLessons(courseId: string) {
    return this.prisma.lesson.findMany({
      where: { courseId },
      orderBy: { orderIndex: 'asc' },
      include: {
        topics: {
          orderBy: { orderIndex: 'asc' },
          include: { contents: { orderBy: { orderIndex: 'asc' } } },
        },
      },
    });
  }

  async updateLesson(id: string, user: AuthUser, dto: UpdateLessonDto) {
    const lesson = await this.prisma.lesson.findUnique({ where: { id } });
    if (!lesson) throw new NotFoundException();
    await this.assertCourseTeacher(lesson.courseId, user);
    return this.prisma.lesson.update({ where: { id }, data: dto });
  }

  async deleteLesson(id: string, user: AuthUser) {
    const lesson = await this.prisma.lesson.findUnique({ where: { id } });
    if (!lesson) throw new NotFoundException();
    await this.assertCourseTeacher(lesson.courseId, user);
    return this.prisma.lesson.delete({ where: { id } });
  }

  // -------- Topics --------
  async createTopic(lessonId: string, user: AuthUser, dto: CreateTopicDto) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
    });
    if (!lesson) throw new NotFoundException();
    await this.assertCourseTeacher(lesson.courseId, user);
    return this.prisma.topic.create({ data: { ...dto, lessonId } });
  }

  async updateTopic(id: string, user: AuthUser, dto: UpdateTopicDto) {
    const topic = await this.prisma.topic.findUnique({
      where: { id },
      include: { lesson: true },
    });
    if (!topic) throw new NotFoundException();
    await this.assertCourseTeacher(topic.lesson.courseId, user);
    return this.prisma.topic.update({ where: { id }, data: dto });
  }

  async deleteTopic(id: string, user: AuthUser) {
    const topic = await this.prisma.topic.findUnique({
      where: { id },
      include: { lesson: true },
    });
    if (!topic) throw new NotFoundException();
    await this.assertCourseTeacher(topic.lesson.courseId, user);
    return this.prisma.topic.delete({ where: { id } });
  }

  // -------- Content Items --------
  private validateContentPayload(dto: CreateContentItemDto | UpdateContentItemDto, type?: ContentType) {
    const t = (dto as CreateContentItemDto).type ?? type;
    if (!t) return;
    if (t === ContentType.VIDEO_YOUTUBE) {
      if (!dto.youtubeUrl) {
        throw new BadRequestException('youtubeUrl is required for VIDEO_YOUTUBE');
      }
      const id = extractYouTubeId(dto.youtubeUrl);
      if (!id) throw new BadRequestException('Invalid YouTube URL');
      (dto as any).youtubeId = id;
    }
    if (t === ContentType.DOCUMENT && !dto.documentKey) {
      throw new BadRequestException('documentKey is required for DOCUMENT');
    }
    if (t === ContentType.TEXT && !dto.body) {
      throw new BadRequestException('body is required for TEXT');
    }
    if (t === ContentType.LINK && !dto.externalUrl) {
      throw new BadRequestException('externalUrl is required for LINK');
    }
  }

  async createContent(
    topicId: string,
    user: AuthUser,
    dto: CreateContentItemDto,
  ) {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      include: { lesson: true },
    });
    if (!topic) throw new NotFoundException();
    await this.assertCourseTeacher(topic.lesson.courseId, user);
    this.validateContentPayload(dto);
    return this.prisma.contentItem.create({ data: { ...dto, topicId } });
  }

  async updateContent(
    id: string,
    user: AuthUser,
    dto: UpdateContentItemDto,
  ) {
    const existing = await this.prisma.contentItem.findUnique({
      where: { id },
      include: { topic: { include: { lesson: true } } },
    });
    if (!existing) throw new NotFoundException();
    await this.assertCourseTeacher(existing.topic.lesson.courseId, user);
    this.validateContentPayload(dto, existing.type);
    return this.prisma.contentItem.update({ where: { id }, data: dto });
  }

  async deleteContent(id: string, user: AuthUser) {
    const existing = await this.prisma.contentItem.findUnique({
      where: { id },
      include: { topic: { include: { lesson: true } } },
    });
    if (!existing) throw new NotFoundException();
    await this.assertCourseTeacher(existing.topic.lesson.courseId, user);
    return this.prisma.contentItem.delete({ where: { id } });
  }

  // -------- Syllabus --------
  getSyllabus(courseId: string) {
    return this.prisma.syllabus.findUnique({
      where: { courseId },
      include: { sections: { orderBy: { orderIndex: 'asc' } } },
    });
  }

  async upsertSyllabus(
    courseId: string,
    user: AuthUser,
    dto: UpsertSyllabusDto,
  ) {
    await this.assertCourseTeacher(courseId, user);
    return this.prisma.$transaction(async (tx) => {
      const syllabus = await tx.syllabus.upsert({
        where: { courseId },
        update: {
          title: dto.title,
          overview: dto.overview,
          documentKey: dto.documentKey,
        },
        create: {
          courseId,
          title: dto.title,
          overview: dto.overview,
          documentKey: dto.documentKey,
        },
      });
      if (dto.sections) {
        await tx.syllabusSection.deleteMany({
          where: { syllabusId: syllabus.id },
        });
        if (dto.sections.length) {
          await tx.syllabusSection.createMany({
            data: dto.sections.map((s) => ({
              syllabusId: syllabus.id,
              title: s.title,
              body: s.body,
              orderIndex: s.orderIndex,
            })),
          });
        }
      }
      return tx.syllabus.findUnique({
        where: { id: syllabus.id },
        include: { sections: { orderBy: { orderIndex: 'asc' } } },
      });
    });
  }
}
