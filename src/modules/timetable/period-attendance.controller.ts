import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  BulkPeriodAttendanceDto,
  CreatePeriodLeaveDto,
  PeriodDateQueryDto,
  PeriodLeavesQueryDto,
  PeriodReportQueryDto,
  RangeQueryDto,
  ReviewPeriodLeaveDto,
} from './dto/periods.dto';
import { PeriodAttendanceService } from './period-attendance.service';

@ApiTags('period-attendance')
@ApiBearerAuth()
@Controller()
export class PeriodAttendanceController {
  constructor(private readonly svc: PeriodAttendanceService) {}

  /** Every period of a date: teacher, status (marked or from the day attendance), substitute, leave request, free teachers. */
  @Roles(Role.ADMIN)
  @Get('period-attendance')
  board(@Query() q: PeriodDateQueryDto) {
    return this.svc.board(q.date);
  }

  @Roles(Role.ADMIN)
  @Post('period-attendance/bulk')
  save(@CurrentUser() user: AuthUser, @Body() dto: BulkPeriodAttendanceDto) {
    return this.svc.saveBoard(user, dto);
  }

  @Roles(Role.ADMIN)
  @Get('period-attendance/report')
  report(@Query() q: PeriodReportQueryDto) {
    return this.svc.report(q);
  }

  @Roles(Role.TEACHER)
  @Post('me/period-leaves')
  requestLeave(@CurrentUser() user: AuthUser, @Body() dto: CreatePeriodLeaveDto) {
    return this.svc.requestLeave(user, dto);
  }

  @Roles(Role.TEACHER)
  @Get('me/period-leaves')
  myLeaves(@CurrentUser() user: AuthUser) {
    return this.svc.myLeaves(user);
  }

  @Roles(Role.ADMIN)
  @Get('period-leaves')
  listLeaves(@Query() q: PeriodLeavesQueryDto) {
    return this.svc.listLeaves(q);
  }

  @Roles(Role.ADMIN)
  @Patch('period-leaves/:id')
  reviewLeave(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReviewPeriodLeaveDto) {
    return this.svc.reviewLeave(user, id, dto);
  }

  @Roles(Role.TEACHER)
  @Get('me/substitutions')
  mySubstitutions(@CurrentUser() user: AuthUser, @Query() q: RangeQueryDto) {
    return this.svc.mySubstitutions(user, q);
  }
}
