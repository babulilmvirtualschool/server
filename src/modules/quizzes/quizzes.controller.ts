import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { QuizzesService } from './quizzes.service';
import {
  CreateQuestionDto,
  CreateQuizDto,
  ManualGradeAnswerDto,
  RecordViolationDto,
  SaveAnswerDto,
  SubmitAttemptDto,
  UpdateQuestionDto,
  UpdateQuizDto,
} from './dto/quiz.dto';

@ApiTags('quizzes')
@ApiBearerAuth()
@Controller()
export class QuizzesController {
  constructor(private readonly svc: QuizzesService) {}

  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('courses/:courseId/quizzes')
  create(
    @Param('courseId') courseId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateQuizDto,
  ) {
    return this.svc.create(courseId, user, dto);
  }

  @Get('courses/:courseId/quizzes')
  list(@Param('courseId') courseId: string) {
    return this.svc.listForCourse(courseId);
  }

  @Get('quizzes/:id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.get(id, user);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Patch('quizzes/:id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateQuizDto,
  ) {
    return this.svc.update(id, user, dto);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('quizzes/:id/publish')
  publish(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.publish(id, user);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Delete('quizzes/:id')
  delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.delete(id, user);
  }

  // Questions
  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('quizzes/:id/questions')
  addQuestion(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateQuestionDto,
  ) {
    return this.svc.addQuestion(id, user, dto);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Patch('questions/:qid')
  updateQuestion(
    @Param('qid') qid: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateQuestionDto,
  ) {
    return this.svc.updateQuestion(qid, user, dto);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Delete('questions/:qid')
  deleteQuestion(@Param('qid') qid: string, @CurrentUser() user: AuthUser) {
    return this.svc.deleteQuestion(qid, user);
  }

  // Attempts
  @Roles(Role.STUDENT)
  @Post('quizzes/:id/attempts')
  start(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.startAttempt(id, user);
  }

  @Get('attempts/:attemptId')
  getAttempt(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.getAttemptView(attemptId, user);
  }

  @Roles(Role.STUDENT)
  @Post('attempts/:attemptId/answers')
  saveAnswer(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: SaveAnswerDto,
  ) {
    return this.svc.saveAnswer(attemptId, user, dto);
  }

  @Roles(Role.STUDENT)
  @Post('attempts/:attemptId/violations')
  violation(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: RecordViolationDto,
  ) {
    return this.svc.recordViolation(attemptId, user, dto);
  }

  @Roles(Role.STUDENT)
  @Post('attempts/:attemptId/submit')
  submit(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: SubmitAttemptDto,
  ) {
    return this.svc.submitAttempt(attemptId, user, dto);
  }

  // Teacher views
  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('quizzes/:id/attempts')
  listAttempts(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.listAttempts(id, user);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('attempts/:attemptId/review')
  review(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.getAttemptForTeacher(attemptId, user);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('attempts/:attemptId/grade')
  @ApiBody({ type: [ManualGradeAnswerDto] })
  manualGrade(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: AuthUser,
    @Body() items: ManualGradeAnswerDto[],
  ) {
    return this.svc.manualGrade(attemptId, user, items);
  }
}
