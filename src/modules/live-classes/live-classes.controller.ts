import {
  Body,
  Controller,
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
import { LiveClassesService } from './live-classes.service';
import {
  CreateLiveClassDto,
  UpdateLiveClassDto,
} from './dto/live-class.dto';

@ApiTags('live-classes')
@ApiBearerAuth()
@Controller()
export class LiveClassesController {
  constructor(private readonly svc: LiveClassesService) {}

  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('courses/:courseId/live-classes')
  create(
    @Param('courseId') courseId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateLiveClassDto,
  ) {
    return this.svc.create(courseId, user, dto);
  }

  @Get('courses/:courseId/live-classes')
  listForCourse(@Param('courseId') courseId: string) {
    return this.svc.listForCourse(courseId);
  }

  @Get('me/live-classes/upcoming')
  upcoming(@CurrentUser() user: AuthUser) {
    return this.svc.upcoming(user);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Patch('live-classes/:id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateLiveClassDto,
  ) {
    return this.svc.update(id, user, dto);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('live-classes/:id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.cancel(id, user);
  }

  @Roles(Role.STUDENT)
  @Post('live-classes/:id/join')
  join(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.studentJoin(id, user);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('live-classes/:id/attendance')
  attendance(@Param('id') id: string) {
    return this.svc.attendance(id);
  }
}
