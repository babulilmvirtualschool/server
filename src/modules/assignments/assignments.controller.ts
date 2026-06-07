import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { AssignmentsService } from './assignments.service';
import {
  CreateAssignmentDto,
  GradeSubmissionDto,
  SubmitAssignmentDto,
  UpdateAssignmentDto,
} from './dto/assignment.dto';

@ApiTags('assignments')
@ApiBearerAuth()
@Controller()
export class AssignmentsController {
  constructor(private readonly svc: AssignmentsService) {}

  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('courses/:courseId/assignments')
  create(
    @Param('courseId') courseId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAssignmentDto,
  ) {
    return this.svc.create(courseId, user, dto);
  }

  @Get('courses/:courseId/assignments')
  list(@Param('courseId') courseId: string) {
    return this.svc.listForCourse(courseId);
  }

  @Get('assignments/:id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Patch('assignments/:id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateAssignmentDto,
  ) {
    return this.svc.update(id, user, dto);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Delete('assignments/:id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.delete(id, user);
  }

  @Roles(Role.STUDENT)
  @Post('assignments/:id/submissions')
  submit(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: SubmitAssignmentDto,
  ) {
    return this.svc.submit(id, user, dto);
  }

  @Roles(Role.STUDENT)
  @Get('assignments/:id/my-submission')
  mySubmission(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.mySubmission(id, user);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('assignments/:id/submissions')
  listSubmissions(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.listSubmissions(id, user);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Patch('submissions/:submissionId/grade')
  grade(
    @Param('submissionId') submissionId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: GradeSubmissionDto,
  ) {
    return this.svc.grade(submissionId, user, dto);
  }
}
