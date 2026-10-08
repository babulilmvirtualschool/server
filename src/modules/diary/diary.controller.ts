import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DiaryService } from './diary.service';
import {
  DiaryDayQueryDto,
  DiaryRangeQueryDto,
  UpsertDiaryEntryDto,
} from './dto/diary.dto';

@ApiTags('diary')
@ApiBearerAuth()
@Controller()
export class DiaryController {
  constructor(private readonly diary: DiaryService) {}

  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('diary')
  upsert(@CurrentUser() user: AuthUser, @Body() dto: UpsertDiaryEntryDto) {
    return this.diary.upsert(user, dto);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Delete('diary/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.diary.remove(user, id);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('courses/:courseId/diary')
  forCourse(
    @CurrentUser() user: AuthUser,
    @Param('courseId') courseId: string,
    @Query() q: DiaryRangeQueryDto,
  ) {
    return this.diary.listForCourse(user, courseId, q);
  }

  @Roles(Role.STUDENT)
  @Get('me/diary')
  mine(@CurrentUser() user: AuthUser, @Query() q: DiaryDayQueryDto) {
    return this.diary.forStudentUser(user, q.date);
  }

  @Roles(Role.PARENT)
  @Get('children/:studentId/diary')
  forChild(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Query() q: DiaryDayQueryDto,
  ) {
    return this.diary.forChild(user, studentId, q.date);
  }
}
