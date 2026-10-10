import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { AttendanceService } from './attendance.service';
import { AttendanceReportQueryDto } from './dto/attendance-report.dto';
import {
  AttendanceRecordsQueryDto,
  BulkStaffAttendanceDto,
} from './dto/attendance-admin.dto';
import { BulkMarkAttendanceDto } from './dto/attendance.dto';
import {
  ListTeacherAttendanceDto,
  MarkTeacherAttendanceDto,
  ReviewTeacherAttendanceDto,
} from './dto/teacher-attendance.dto';

@ApiTags('attendance')
@ApiBearerAuth()
@Controller()
export class AttendanceController {
  constructor(private readonly svc: AttendanceService) {}

  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('attendance/bulk')
  bulk(
    @CurrentUser() user: AuthUser,
    @Body() dto: BulkMarkAttendanceDto,
  ) {
    return this.svc.bulkMark(user, dto);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('sections/:sectionId/attendance')
  forSection(
    @Param('sectionId') sectionId: string,
    @Query('date') date: string,
  ) {
    return this.svc.listForSectionDate(sectionId, date);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('courses/:courseId/attendance')
  forCourse(
    @Param('courseId') courseId: string,
    @Query('date') date: string,
  ) {
    return this.svc.listForCourseDate(courseId, date);
  }

  @Roles(Role.STUDENT)
  @Get('me/attendance')
  myAttendance(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.summaryForStudent(user.id, from, to);
  }

  @Roles(Role.TEACHER)
  @Post('me/teacher-attendance')
  markTeacherSelf(
    @CurrentUser() user: AuthUser,
    @Body() dto: MarkTeacherAttendanceDto,
  ) {
    return this.svc.markTeacherSelf(user, dto);
  }

  @Roles(Role.TEACHER)
  @Get('me/teacher-attendance')
  myTeacherAttendance(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.listTeacherSelf(user, from, to);
  }

  @Roles(Role.ADMIN)
  @Get('teacher-attendance')
  listTeacherAttendance(@Query() q: ListTeacherAttendanceDto) {
    return this.svc.listTeacherAttendanceAdmin(q);
  }

  @Roles(Role.ADMIN)
  @Post('teacher-attendance/bulk')
  bulkStaff(@CurrentUser() user: AuthUser, @Body() dto: BulkStaffAttendanceDto) {
    return this.svc.bulkMarkStaff(user, dto);
  }

  @Roles(Role.ADMIN)
  @Get('attendance/records')
  records(@Query() q: AttendanceRecordsQueryDto) {
    return this.svc.recordsForReport(q);
  }

  @Roles(Role.ADMIN)
  @Patch('teacher-attendance/:id')
  reviewTeacherAttendance(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ReviewTeacherAttendanceDto,
  ) {
    return this.svc.reviewTeacherAttendance(id, user, dto);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('attendance/reports')
  classReport(
    @CurrentUser() user: AuthUser,
    @Query() q: AttendanceReportQueryDto,
  ) {
    return this.svc.classReport(user, q.courseId, q.date);
  }

  @Roles(Role.ADMIN)
  @Get('attendance/sessions')
  sessions(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('courseId') courseId?: string,
  ) {
    return this.svc.listSessionsAdmin(from, to, courseId);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('courses/:courseId/roster')
  courseRoster(
    @CurrentUser() user: AuthUser,
    @Param('courseId') courseId: string,
  ) {
    return this.svc.rosterForCourse(user, courseId);
  }
}
