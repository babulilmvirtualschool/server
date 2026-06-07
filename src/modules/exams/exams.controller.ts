import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
  RecordExamResultDto,
  UpdateExamDto,
} from './dto/exam.dto';

@ApiTags('exams')
@ApiBearerAuth()
@Controller()
export class ExamsController {
  constructor(private readonly svc: ExamsService) {}

  @Roles(Role.ADMIN)
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

  @Roles(Role.ADMIN)
  @Post('exams/:id/papers')
  createPaper(@Param('id') id: string, @Body() dto: CreateExamPaperDto) {
    return this.svc.createPaper(id, dto);
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
