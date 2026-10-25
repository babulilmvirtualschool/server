import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AnswerLivePollDto, CreateLivePollDto } from './dto/live-poll.dto';
import { LivePollsService } from './live-polls.service';

/** End-of-lesson quick quiz / poll for live classes. */
@ApiTags('live-classes')
@ApiBearerAuth()
@Controller()
export class LivePollsController {
  constructor(private readonly polls: LivePollsService) {}

  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('live-classes/:id/polls')
  list(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.polls.list(id, user);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('live-classes/:id/polls')
  create(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: CreateLivePollDto) {
    return this.polls.create(id, user, dto);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('live-polls/:id/open')
  open(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.polls.open(id, user);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Post('live-polls/:id/close')
  close(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.polls.close(id, user);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Delete('live-polls/:id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.polls.remove(id, user);
  }

  @Roles(Role.TEACHER)
  @Get('me/live-classes/recent')
  recent(@CurrentUser() user: AuthUser) {
    return this.polls.recentClasses(user);
  }

  @Roles(Role.STUDENT)
  @Get('me/live-polls')
  mine(@CurrentUser() user: AuthUser) {
    return this.polls.mine(user);
  }

  @Roles(Role.STUDENT)
  @Post('live-polls/:id/answer')
  answer(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: AnswerLivePollDto) {
    return this.polls.answer(id, user, dto);
  }
}
