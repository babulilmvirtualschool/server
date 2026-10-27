import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsBoolean } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AddCategoryDto,
  CreateGradeScaleDto,
  CreateResultTermDto,
  ReportCardSettingsDto,
  ResultsQueryDto,
  SaveSheetDto,
  SheetQueryDto,
  UpdateGradeScaleDto,
  UpdateResultTermDto,
  UpdateSummaryDto,
} from './dto/results.dto';
import { LeaderboardService } from './leaderboard.service';
import { ResultsService } from './results.service';

class PublishDto {
  @IsBoolean()
  published!: boolean;
}

/** PDF1 13.1–13.4 results; PDF2 Teacher 6 / 10 / 11, Student 3 / 5–7 / 9. */
@ApiTags('results')
@ApiBearerAuth()
@Controller()
export class ResultsController {
  constructor(
    private readonly svc: ResultsService,
    private readonly board: LeaderboardService,
  ) {}

  // ---- grading scales ----
  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('grade-scales')
  scales(@Query('academicYearId') academicYearId?: string) {
    return this.svc.listScales(academicYearId);
  }

  @Roles(Role.ADMIN)
  @Post('grade-scales')
  createScale(@Body() dto: CreateGradeScaleDto) {
    return this.svc.createScale(dto);
  }

  @Roles(Role.ADMIN)
  @Patch('grade-scales/:id')
  updateScale(@Param('id') id: string, @Body() dto: UpdateGradeScaleDto) {
    return this.svc.updateScale(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete('grade-scales/:id')
  deleteScale(@Param('id') id: string) {
    return this.svc.deleteScale(id);
  }

  // ---- result terms ----
  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('result-terms')
  terms(@Query('academicYearId') academicYearId?: string) {
    return this.svc.listTerms(academicYearId);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('result-terms/:id')
  term(@Param('id') id: string) {
    return this.svc.getTerm(id);
  }

  @Roles(Role.ADMIN)
  @Post('result-terms')
  createTerm(@Body() dto: CreateResultTermDto) {
    return this.svc.createTerm(dto);
  }

  @Roles(Role.ADMIN)
  @Patch('result-terms/:id')
  updateTerm(@Param('id') id: string, @Body() dto: UpdateResultTermDto) {
    return this.svc.updateTerm(id, dto);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('result-terms/:id/categories')
  addCategory(@Param('id') id: string, @Body() dto: AddCategoryDto) {
    return this.svc.addCategory(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete('result-terms/:id')
  deleteTerm(@Param('id') id: string) {
    return this.svc.deleteTerm(id);
  }

  // ---- marks entry ----
  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('result-terms/:id/sheet')
  sheet(@Param('id') id: string, @Query() q: SheetQueryDto, @CurrentUser() user: AuthUser) {
    return this.svc.sheet(id, q.courseId, user);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('result-terms/:id/sheet/auto')
  autoFill(@Param('id') id: string, @Body() q: SheetQueryDto, @CurrentUser() user: AuthUser) {
    return this.svc.autoFill(id, q.courseId, user);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Put('result-terms/:id/sheet')
  saveSheet(@Param('id') id: string, @Body() dto: SaveSheetDto, @CurrentUser() user: AuthUser) {
    return this.svc.saveSheet(id, dto, user);
  }

  // ---- compile / lock ----
  @Roles(Role.ADMIN)
  @Post('result-terms/:id/compile')
  compile(@Param('id') id: string) {
    return this.svc.compile(id);
  }

  @Roles(Role.ADMIN)
  @Post('result-terms/:id/recalculate')
  recalculate(@Param('id') id: string) {
    return this.svc.recalculate(id);
  }

  @Roles(Role.ADMIN)
  @Post('result-terms/:id/lock')
  lock(@Param('id') id: string) {
    return this.svc.lock(id);
  }

  @Roles(Role.ADMIN)
  @Post('result-terms/:id/reopen')
  reopen(@Param('id') id: string) {
    return this.svc.reopen(id);
  }

  @Roles(Role.ADMIN)
  @Post('result-terms/:id/publish')
  publish(@Param('id') id: string, @Body() dto: PublishDto) {
    return this.svc.publish(id, dto.published);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('result-terms/:id/audit')
  audit(@Param('id') id: string) {
    return this.svc.audit(id);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('result-terms/:id/results')
  results(@Param('id') id: string, @Query() q: ResultsQueryDto, @CurrentUser() user: AuthUser) {
    return this.svc.results(id, q, user);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Patch('result-summaries/:id')
  updateSummary(@Param('id') id: string, @Body() dto: UpdateSummaryDto, @CurrentUser() user: AuthUser) {
    return this.svc.updateSummary(id, dto, user);
  }

  // ---- report cards ----
  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('report-card-settings')
  settings() {
    return this.svc.settings();
  }

  @Roles(Role.ADMIN)
  @Put('report-card-settings')
  saveSettings(@Body() dto: ReportCardSettingsDto, @CurrentUser() user: AuthUser) {
    return this.svc.saveSettings(dto, user);
  }

  // ---- students / parents ----
  @Roles(Role.STUDENT)
  @Get('me/result-cards')
  myCards(@CurrentUser() user: AuthUser) {
    return this.svc.myResultCards(user);
  }

  @Roles(Role.STUDENT)
  @Get('me/grades')
  myGrades(@CurrentUser() user: AuthUser) {
    return this.svc.myGrades(user);
  }

  @Roles(Role.PARENT)
  @Get('children/:studentId/result-cards')
  childCards(@Param('studentId') studentId: string, @CurrentUser() user: AuthUser) {
    return this.svc.childResultCards(user, studentId);
  }

  @Roles(Role.PARENT)
  @Get('children/:studentId/grades')
  childGrades(@Param('studentId') studentId: string, @CurrentUser() user: AuthUser) {
    return this.svc.childGrades(user, studentId);
  }

  // ---- leaderboard ----
  @Roles(Role.ADMIN, Role.TEACHER, Role.STUDENT)
  @Get('leaderboard')
  leaderboard(@Query('sectionId') sectionId: string | undefined, @CurrentUser() user: AuthUser) {
    return this.board.leaderboard(user, sectionId);
  }
}
