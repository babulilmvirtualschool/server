import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { ContentService } from './content.service';
import { CreateLessonDto, UpdateLessonDto } from './dto/lesson.dto';
import { CreateTopicDto, UpdateTopicDto } from './dto/topic.dto';
import {
  CreateContentItemDto,
  UpdateContentItemDto,
} from './dto/content-item.dto';
import { UpsertSyllabusDto } from './dto/syllabus.dto';

@ApiTags('content')
@ApiBearerAuth()
@Controller()
export class ContentController {
  constructor(private readonly svc: ContentService) {}

  // ---- Lessons ----
  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('courses/:courseId/lessons')
  createLesson(
    @Param('courseId') courseId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateLessonDto,
  ) {
    return this.svc.createLesson(courseId, user, dto);
  }

  @Get('courses/:courseId/lessons')
  listLessons(@Param('courseId') courseId: string) {
    return this.svc.listLessons(courseId);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Patch('lessons/:id')
  updateLesson(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateLessonDto,
  ) {
    return this.svc.updateLesson(id, user, dto);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Delete('lessons/:id')
  deleteLesson(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.deleteLesson(id, user);
  }

  // ---- Topics ----
  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('lessons/:lessonId/topics')
  createTopic(
    @Param('lessonId') lessonId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTopicDto,
  ) {
    return this.svc.createTopic(lessonId, user, dto);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Patch('topics/:id')
  updateTopic(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateTopicDto,
  ) {
    return this.svc.updateTopic(id, user, dto);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Delete('topics/:id')
  deleteTopic(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.deleteTopic(id, user);
  }

  // ---- Content Items ----
  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('topics/:topicId/content')
  createContent(
    @Param('topicId') topicId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateContentItemDto,
  ) {
    return this.svc.createContent(topicId, user, dto);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Patch('content/:id')
  updateContent(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateContentItemDto,
  ) {
    return this.svc.updateContent(id, user, dto);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Delete('content/:id')
  deleteContent(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.deleteContent(id, user);
  }

  // ---- Syllabus ----
  @Get('courses/:courseId/syllabus')
  getSyllabus(@Param('courseId') courseId: string) {
    return this.svc.getSyllabus(courseId);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Put('courses/:courseId/syllabus')
  upsertSyllabus(
    @Param('courseId') courseId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertSyllabusDto,
  ) {
    return this.svc.upsertSyllabus(courseId, user, dto);
  }
}
