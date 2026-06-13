import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateStudentLeaveDto } from './dto/create-student-leave.dto';
import { CreateTeacherLeaveDto } from './dto/create-teacher-leave.dto';
import { ListLeavesDto } from './dto/list-leaves.dto';
import { UpdateLeaveStatusDto } from './dto/update-leave-status.dto';
import { LeaveService } from './leave.service';

@ApiTags('leave')
@ApiBearerAuth()
@Controller()
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Roles(Role.TEACHER)
  @Post('me/teacher-leaves')
  createTeacherLeave(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTeacherLeaveDto,
  ) {
    return this.leave.createTeacherLeave(user, dto);
  }

  @Roles(Role.TEACHER)
  @Get('me/teacher-leaves')
  myTeacherLeaves(@CurrentUser() user: AuthUser, @Query() q: ListLeavesDto) {
    return this.leave.listMyTeacherLeaves(user, q);
  }

  @Roles(Role.STUDENT)
  @Post('me/student-leaves')
  createStudentLeave(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateStudentLeaveDto,
  ) {
    return this.leave.createStudentLeave(user, dto);
  }

  @Roles(Role.STUDENT)
  @Get('me/student-leaves')
  myStudentLeaves(@CurrentUser() user: AuthUser, @Query() q: ListLeavesDto) {
    return this.leave.listMyStudentLeaves(user, q);
  }

  @Roles(Role.ADMIN)
  @Get('teacher-leaves')
  listTeacherLeaves(@Query() q: ListLeavesDto) {
    return this.leave.listTeacherLeavesAdmin(q);
  }

  @Roles(Role.ADMIN)
  @Patch('teacher-leaves/:id')
  reviewTeacherLeave(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateLeaveStatusDto,
  ) {
    return this.leave.updateTeacherLeaveStatus(id, user, dto);
  }

  @Roles(Role.ADMIN)
  @Get('student-leaves')
  listStudentLeaves(@Query() q: ListLeavesDto) {
    return this.leave.listStudentLeavesAdmin(q);
  }

  @Roles(Role.ADMIN)
  @Patch('student-leaves/:id')
  reviewStudentLeave(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateLeaveStatusDto,
  ) {
    return this.leave.updateStudentLeaveStatus(id, user, dto);
  }
}
