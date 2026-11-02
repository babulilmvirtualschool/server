import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CommunicationService } from './communication.service';
import { ChatPairQueryDto, CreateComplaintDto, ListComplaintsDto, RateTeacherDto, SendChatDto, UpdateComplaintDto } from './dto/communication.dto';

/** PDF1 7.1 chat, 7.2 complaints & suggestions, parents' star marks for teachers. */
@ApiTags('communication')
@ApiBearerAuth()
@Controller()
export class CommunicationController {
  constructor(private readonly svc: CommunicationService) {}

  @Roles(Role.ADMIN, Role.TEACHER, Role.STUDENT)
  @Get('chat/inbox')
  inbox(@CurrentUser() user: AuthUser) {
    return this.svc.inbox(user);
  }

  @Roles(Role.ADMIN, Role.TEACHER, Role.STUDENT)
  @Get('chat/unread')
  unread(@CurrentUser() user: AuthUser) {
    return this.svc.unreadCount(user);
  }

  @Roles(Role.ADMIN, Role.TEACHER, Role.STUDENT)
  @Get('chat/with/:userId')
  conversation(@Param('userId') userId: string, @CurrentUser() user: AuthUser) {
    return this.svc.conversation(user, userId);
  }

  @Roles(Role.ADMIN, Role.TEACHER, Role.STUDENT)
  @Post('chat/messages')
  send(@Body() dto: SendChatDto, @CurrentUser() user: AuthUser) {
    return this.svc.send(user, dto);
  }

  @Roles(Role.ADMIN)
  @Get('chat/conversations')
  conversations(@Query('search') search?: string) {
    return this.svc.adminConversations(search);
  }

  @Roles(Role.ADMIN)
  @Get('chat/conversation')
  adminConversation(@Query() q: ChatPairQueryDto) {
    return this.svc.adminConversation(q);
  }

  @Roles(Role.STUDENT, Role.PARENT)
  @Get('complaints/options')
  options(@CurrentUser() user: AuthUser) {
    return this.svc.complaintOptions(user);
  }

  @Roles(Role.STUDENT, Role.PARENT)
  @Post('complaints')
  create(@Body() dto: CreateComplaintDto, @CurrentUser() user: AuthUser) {
    return this.svc.createComplaint(user, dto);
  }

  @Roles(Role.STUDENT, Role.PARENT)
  @Get('me/complaints')
  mine(@CurrentUser() user: AuthUser) {
    return this.svc.myComplaints(user);
  }

  @Roles(Role.ADMIN)
  @Get('complaints')
  list(@Query() q: ListComplaintsDto) {
    return this.svc.listComplaints(q);
  }

  @Roles(Role.ADMIN)
  @Patch('complaints/:id')
  update(@Param('id') id: string, @Body() dto: UpdateComplaintDto, @CurrentUser() user: AuthUser) {
    return this.svc.updateComplaint(user, id, dto);
  }

  @Roles(Role.PARENT)
  @Get('teacher-ratings/mine')
  ratingOptions(@CurrentUser() user: AuthUser) {
    return this.svc.ratingOptions(user);
  }

  @Roles(Role.PARENT)
  @Put('teacher-ratings')
  rate(@Body() dto: RateTeacherDto, @CurrentUser() user: AuthUser) {
    return this.svc.rate(user, dto);
  }

  @Roles(Role.ADMIN)
  @Get('teacher-ratings')
  report() {
    return this.svc.ratingsReport();
  }
}
