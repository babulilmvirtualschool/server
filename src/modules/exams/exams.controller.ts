import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { ExamsService } from './exams.service';
import {
  CreateExamDto,
  CreateExamPaperDto,
  DuplicateExamPaperDto,
  ListExamPapersQueryDto,
  RecordExamResultDto,
  SetPaperQuestionsDto,
  UpdateExamDto,
  UpdateExamPaperDto,
} from './dto/exam.dto';

@ApiTags('exams')
@ApiBearerAuth()
@Controller()
export class ExamsController {
  constructor(private readonly svc: ExamsService) {}

  /** PDF2 Teacher 3 "+Add Exams (do Same as from Admin Portal)": teachers may add exam sessions too. */
  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('exams')
  create(@Body() dto: CreateExamDto) {
    return this.svc.createExam(dto);
  }

  @Get('exams')
  list(@Query('academicYearId') academicYearId?: string) {
    return this.svc.listExams(academicYearId);
  }

  @Get('exams/:id')
  get(@Param('id') id: string) {
    return this.svc.getExam(id);
  }

  @Roles(Role.ADMIN)
  @Patch('exams/:id')
  update(@Param('id') id: string, @Body() dto: UpdateExamDto) {
    return this.svc.updateExam(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete('exams/:id')
  remove(@Param('id') id: string) {
    return this.svc.deleteExam(id);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('exams/:id/papers')
  createPaper(@Param('id') id: string, @Body() dto: CreateExamPaperDto, @CurrentUser() user: AuthUser) {
    return this.svc.createPaper(id, dto, user);
  }

  /** PDF1 10.1 exams / online tests with filters (course, class, exam type, mode, status, dates). */
  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('exam-papers')
  listPapers(@Query() q: ListExamPapersQueryDto, @CurrentUser() user: AuthUser) {
    return this.svc.listPapers(q, user);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('exam-papers/:paperId/duplicate')
  duplicatePaper(@Param('paperId') paperId: string, @Body() dto: DuplicateExamPaperDto, @CurrentUser() user: AuthUser) {
    return this.svc.duplicatePaper(paperId, dto, user);
  }

  /** PDF1 10.2 "Invigilator / Duty Teacher" picker: active teachers and non-teaching staff (teachers can't list users). */
  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('exam-invigilators')
  invigilators() {
    return this.svc.invigilators();
  }

  /** PDF1 10.2 Auto-detect room / teacher (invigilator) / class conflicts. */
  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('exams/:id/conflicts')
  conflicts(@Param('id') id: string) {
    return this.svc.conflicts(id);
  }

  /** PDF2 Student 2: published date sheets and exams (file, text, online test) of my classes. */
  @Roles(Role.STUDENT)
  @Get('me/exams')
  myExams(@CurrentUser() user: AuthUser) {
    return this.svc.myExams(user);
  }

  @Roles(Role.ADMIN)
  @Get('exam-papers/:paperId')
  getPaper(@Param('paperId') paperId: string) {
    return this.svc.getPaper(paperId);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Patch('exam-papers/:paperId')
  updatePaper(
    @Param('paperId') paperId: string,
    @Body() dto: UpdateExamPaperDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.updatePaper(paperId, dto, user);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Delete('exam-papers/:paperId')
  deletePaper(@Param('paperId') paperId: string, @CurrentUser() user: AuthUser) {
    return this.svc.deletePaper(paperId, user);
  }

  @Roles(Role.ADMIN)
  @Put('exam-papers/:paperId/questions')
  setPaperQuestions(
    @Param('paperId') paperId: string,
    @Body() dto: SetPaperQuestionsDto,
  ) {
    return this.svc.setPaperQuestions(paperId, dto.questionIds);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('exam-papers/:paperId/results')
  recordResult(
    @Param('paperId') paperId: string,
    @Body() dto: RecordExamResultDto,
  ) {
    return this.svc.recordResult(paperId, dto);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('exam-papers/:paperId/results/bulk')
  @ApiBody({ type: [RecordExamResultDto] })
  bulk(
    @Param('paperId') paperId: string,
    @Body() items: RecordExamResultDto[],
  ) {
    return this.svc.bulkRecordResults(paperId, items);
  }

  @Roles(Role.ADMIN)
  @Post('exam-papers/:paperId/publish')
  publish(@Param('paperId') paperId: string) {
    return this.svc.publishResults(paperId);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('exam-papers/:paperId/results')
  resultsForPaper(@Param('paperId') paperId: string) {
    return this.svc.resultsForPaper(paperId);
  }

  @Roles(Role.STUDENT)
  @Get('me/results')
  myResults(@CurrentUser() user: AuthUser) {
    return this.svc.resultsForStudent(user.id);
  }
}
