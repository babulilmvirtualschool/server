import {
  Body,
  Controller,
  Get,
  Param,
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
import { BulkMarkAttendanceDto } from './dto/attendance.dto';

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
}
