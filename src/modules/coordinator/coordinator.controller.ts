import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CoordinatorService } from './coordinator.service';
import {
  CreateCheckDto,
  CreateVisitDto,
  ListChecksDto,
  ListVisitsDto,
  PerformanceQueryDto,
  RangeQueryDto,
  SaveWeeklyReportDto,
  UpdateCheckDto,
  UpdateVisitDto,
  WeekQueryDto,
} from './dto/coordinator.dto';

/** PDF1 8 Coordinator module (admin portal). */
@ApiTags('coordinator')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller()
export class CoordinatorController {
  constructor(private readonly svc: CoordinatorService) {}

  @Get('coordinator/dashboard')
  dashboard() {
    return this.svc.dashboard();
  }

  @Get('coordinator/teacher-performance')
  performance(@Query() q: PerformanceQueryDto) {
    return this.svc.teacherPerformance(q);
  }

  @Get('class-visits')
  visits(@Query() q: ListVisitsDto) {
    return this.svc.listVisits(q);
  }

  @Post('class-visits')
  createVisit(@Body() dto: CreateVisitDto, @CurrentUser() user: AuthUser) {
    return this.svc.createVisit(dto, user);
  }

  @Patch('class-visits/:id')
  updateVisit(@Param('id') id: string, @Body() dto: UpdateVisitDto) {
    return this.svc.updateVisit(id, dto);
  }

  @Delete('class-visits/:id')
  removeVisit(@Param('id') id: string) {
    return this.svc.removeVisit(id);
  }

  @Get('coordinator-checks')
  checks(@Query() q: ListChecksDto) {
    return this.svc.listChecks(q);
  }

  @Post('coordinator-checks')
  createCheck(@Body() dto: CreateCheckDto, @CurrentUser() user: AuthUser) {
    return this.svc.createCheck(dto, user);
  }

  @Patch('coordinator-checks/:id')
  updateCheck(@Param('id') id: string, @Body() dto: UpdateCheckDto) {
    return this.svc.updateCheck(id, dto);
  }

  @Delete('coordinator-checks/:id')
  removeCheck(@Param('id') id: string) {
    return this.svc.removeCheck(id);
  }

  @Get('head-teacher-reports')
  weekly(@Query() q: RangeQueryDto) {
    return this.svc.listWeekly(q);
  }

  @Get('head-teacher-reports/week')
  week(@Query() q: WeekQueryDto) {
    return this.svc.getWeek(q);
  }

  @Put('head-teacher-reports')
  saveWeek(@Body() dto: SaveWeeklyReportDto, @CurrentUser() user: AuthUser) {
    return this.svc.saveWeek(dto, user);
  }

  @Delete('head-teacher-reports/:id')
  removeWeek(@Param('id') id: string) {
    return this.svc.removeWeek(id);
  }
}
