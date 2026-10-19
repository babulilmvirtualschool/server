import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AttendanceRulesService } from './attendance-rules.service';
import {
  ClosuresQueryDto,
  CreateClosureDto,
  DayInfoQueryDto,
  SaveAttendanceSettingsDto,
  SaveSectionShiftsDto,
  SaveStaffTimingDto,
} from './dto/attendance-settings.dto';

/** Attendance settings (PDF 2): timings, late threshold, shifts, per-staff timings, school closures. */
@ApiTags('attendance-settings')
@ApiBearerAuth()
@Controller()
export class AttendanceSettingsController {
  constructor(private readonly rules: AttendanceRulesService) {}

  @Roles(Role.ADMIN)
  @Get('attendance-settings')
  getSettings() {
    return this.rules.getSettings();
  }

  @Roles(Role.ADMIN)
  @Put('attendance-settings')
  saveSettings(@Body() dto: SaveAttendanceSettingsDto) {
    return this.rules.saveSettings(dto);
  }

  @Roles(Role.ADMIN)
  @Get('attendance-settings/shifts')
  sectionShifts() {
    return this.rules.listSectionShifts();
  }

  @Roles(Role.ADMIN)
  @Put('attendance-settings/shifts')
  saveSectionShifts(@Body() dto: SaveSectionShiftsDto) {
    return this.rules.saveSectionShifts(dto);
  }

  @Roles(Role.ADMIN)
  @Get('staff-timings')
  staffTimings() {
    return this.rules.listStaffTimings();
  }

  @Roles(Role.ADMIN)
  @Put('staff-timings/:teacherId')
  saveStaffTiming(@Param('teacherId') teacherId: string, @Body() dto: SaveStaffTimingDto) {
    return this.rules.saveStaffTiming(teacherId, dto);
  }

  @Roles(Role.ADMIN)
  @Delete('staff-timings/:teacherId')
  removeStaffTiming(@Param('teacherId') teacherId: string) {
    return this.rules.removeStaffTiming(teacherId);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('school-closures')
  closures(@Query() q: ClosuresQueryDto) {
    return this.rules.listClosures(q);
  }

  @Roles(Role.ADMIN)
  @Post('school-closures')
  createClosure(@Body() dto: CreateClosureDto) {
    return this.rules.createClosure(dto);
  }

  @Roles(Role.ADMIN)
  @Delete('school-closures/:id')
  removeClosure(@Param('id') id: string) {
    return this.rules.removeClosure(id);
  }

  /** The day's rule for a class (closed? start time, late after) — shown on the marking screens. */
  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('attendance/day-info')
  dayInfo(@Query() q: DayInfoQueryDto) {
    return this.rules.studentDay(q.date, q.sectionId);
  }

  /** Every class for a date: students, marked, complete, rule. */
  @Roles(Role.ADMIN)
  @Get('attendance/day-overview')
  dayOverview(@Query() q: DayInfoQueryDto) {
    return this.rules.dayOverview(q.date);
  }

  /** Per-teacher rule for a date (their timing / threshold, closures for teachers). */
  @Roles(Role.ADMIN)
  @Get('attendance/staff-day-info')
  staffDayInfo(@Query() q: DayInfoQueryDto) {
    return this.rules.allStaffDays(q.date);
  }
}
