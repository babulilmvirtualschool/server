import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { SalariesService } from './salaries.service';
import {
  CreateSalaryStructureDto,
  RecordSalaryPaymentDto,
} from './dto/salary.dto';

@ApiTags('salaries')
@ApiBearerAuth()
@Controller()
export class SalariesController {
  constructor(private readonly svc: SalariesService) {}

  @Roles(Role.ADMIN)
  @Post('salary-structures')
  create(@Body() dto: CreateSalaryStructureDto) {
    return this.svc.createStructure(dto);
  }

  @Roles(Role.ADMIN)
  @Get('teachers/:teacherId/salary-structures')
  list(@Param('teacherId') teacherId: string) {
    return this.svc.listStructuresForTeacher(teacherId);
  }

  @Roles(Role.ADMIN)
  @Post('salary-payments')
  record(
    @CurrentUser() user: AuthUser,
    @Body() dto: RecordSalaryPaymentDto,
  ) {
    return this.svc.recordPayment(user, dto);
  }

  @Roles(Role.ADMIN)
  @Get('teachers/:teacherId/salary-payments')
  listPayments(@Param('teacherId') teacherId: string) {
    return this.svc.listPaymentsForTeacher(teacherId);
  }

  @Roles(Role.TEACHER)
  @Get('me/salary-payments')
  myPayments(@CurrentUser() user: AuthUser) {
    return this.svc.paymentsForTeacherUser(user.id);
  }
}
