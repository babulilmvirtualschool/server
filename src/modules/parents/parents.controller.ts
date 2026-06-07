import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { ParentsService } from './parents.service';

@ApiTags('parents')
@ApiBearerAuth()
@Roles(Role.PARENT)
@Controller()
export class ParentsController {
  constructor(private readonly svc: ParentsService) {}

  @Get('me/children')
  myChildren(@CurrentUser() user: AuthUser) {
    return this.svc.myChildren(user);
  }

  @Get('children/:studentId/attendance')
  attendance(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.childAttendance(user, studentId, from, to);
  }

  @Get('children/:studentId/results')
  results(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
  ) {
    return this.svc.childResults(user, studentId);
  }

  @Get('children/:studentId/invoices')
  invoices(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
  ) {
    return this.svc.childInvoices(user, studentId);
  }
}
