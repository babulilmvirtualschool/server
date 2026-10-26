import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { StaffAlertDto } from './dto/staff-alert.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('unread') unread?: string,
  ) {
    return this.svc.listMine(user, unread === 'true');
  }

  @Post(':id/read')
  markRead(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.markRead(user, id);
  }

  @Post('read-all')
  markAll(@CurrentUser() user: AuthUser) {
    return this.svc.markAllRead(user);
  }

  /** Admin — show an emergency / security alert or notice inside the teachers' and / or non-teaching staff's portal. */
  @Roles(Role.ADMIN)
  @Post('staff-alert')
  staffAlert(@Body() dto: StaffAlertDto) {
    return this.svc.alertStaff(dto);
  }
}
