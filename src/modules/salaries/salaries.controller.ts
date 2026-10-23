import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { SalariesService } from './salaries.service';
import {
  AdvancesQueryDto,
  AnnualSalariesQueryDto,
  CreateAdvanceDto,
  CreateFineDto,
  CreateSalaryStructureDto,
  FinesQueryDto,
  GenerateSalariesDto,
  PaySalaryDto,
  SalariesQueryDto,
} from './dto/salary.dto';

@ApiTags('salaries')
@ApiBearerAuth()
@Controller()
export class SalariesController {
  constructor(private readonly svc: SalariesService) {}

  @Roles(Role.ADMIN)
  @Get('salary-staff')
  staff() {
    return this.svc.staff();
  }

  @Roles(Role.ADMIN)
  @Post('salary-structures')
  create(@Body() dto: CreateSalaryStructureDto) {
    return this.svc.assign(dto);
  }

  @Roles(Role.ADMIN)
  @Get('teachers/:teacherId/salary-structures')
  list(@Param('teacherId') teacherId: string) {
    return this.svc.listStructuresForTeacher(teacherId);
  }

  @Roles(Role.ADMIN)
  @Post('salaries/generate')
  generate(@Body() dto: GenerateSalariesDto) {
    return this.svc.generate(dto);
  }

  @Roles(Role.ADMIN)
  @Get('salaries')
  salaries(@Query() q: SalariesQueryDto) {
    return this.svc.list(q);
  }

  @Roles(Role.ADMIN)
  @Get('salaries/annual')
  annual(@Query() q: AnnualSalariesQueryDto) {
    return this.svc.annual(q);
  }

  @Roles(Role.ADMIN)
  @Post('salaries/:id/pay')
  pay(@Param('id') id: string, @Body() dto: PaySalaryDto, @CurrentUser() user: AuthUser) {
    return this.svc.pay(id, dto, user);
  }

  @Roles(Role.ADMIN)
  @Post('salaries/:id/regenerate')
  regenerate(@Param('id') id: string) {
    return this.svc.regenerate(id);
  }

  @Roles(Role.ADMIN)
  @Delete('salaries/:id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @Roles(Role.ADMIN)
  @Get('salaries/:id/slip')
  slip(@Param('id') id: string) {
    return this.svc.slip(id);
  }

  @Roles(Role.ADMIN)
  @Get('salary-advances')
  advances(@Query() q: AdvancesQueryDto) {
    return this.svc.advances(q);
  }

  @Roles(Role.ADMIN)
  @Post('salary-advances')
  createAdvance(@Body() dto: CreateAdvanceDto) {
    return this.svc.createAdvance(dto);
  }

  @Roles(Role.ADMIN)
  @Delete('salary-advances/:id')
  deleteAdvance(@Param('id') id: string) {
    return this.svc.deleteAdvance(id);
  }

  @Roles(Role.ADMIN)
  @Get('salary-fines')
  fines(@Query() q: FinesQueryDto) {
    return this.svc.fines(q);
  }

  @Roles(Role.ADMIN)
  @Post('salary-fines')
  createFine(@Body() dto: CreateFineDto) {
    return this.svc.createFine(dto);
  }

  @Roles(Role.ADMIN)
  @Delete('salary-fines/:id')
  deleteFine(@Param('id') id: string) {
    return this.svc.deleteFine(id);
  }

  @Roles(Role.ADMIN)
  @Get('teachers/:teacherId/salary-payments')
  listPayments(@Param('teacherId') teacherId: string) {
    return this.svc.listPaymentsForTeacher(teacherId);
  }

  @Roles(Role.TEACHER, Role.STAFF)
  @Get('me/pay')
  mine(@CurrentUser() user: AuthUser) {
    return this.svc.mine(user);
  }

  @Roles(Role.TEACHER, Role.STAFF)
  @Get('me/salary-slips/:id')
  mySlip(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.slip(id, user);
  }

  @Roles(Role.TEACHER, Role.STAFF)
  @Get('me/salary-payments')
  myPayments(@CurrentUser() user: AuthUser) {
    return this.svc.paymentsForTeacherUser(user.id);
  }
}
