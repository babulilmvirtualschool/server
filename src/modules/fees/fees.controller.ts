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
import { InvoiceStatus, Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { FeesService } from './fees.service';
import {
  CreateFeeStructureDto,
  GenerateInvoicesDto,
  RecordFeePaymentDto,
} from './dto/fees.dto';

@ApiTags('fees')
@ApiBearerAuth()
@Controller()
export class FeesController {
  constructor(private readonly svc: FeesService) {}

  @Roles(Role.ADMIN)
  @Post('fee-structures')
  createStructure(@Body() dto: CreateFeeStructureDto) {
    return this.svc.createStructure(dto);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('fee-structures')
  list(
    @Query('classId') classId?: string,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.svc.listStructures(classId, academicYearId);
  }

  @Roles(Role.ADMIN)
  @Delete('fee-structures/:id')
  deleteStructure(@Param('id') id: string) {
    return this.svc.deleteStructure(id);
  }

  @Roles(Role.ADMIN)
  @Post('fee-invoices/generate')
  generate(@Body() dto: GenerateInvoicesDto) {
    return this.svc.generateInvoices(dto);
  }

  @Roles(Role.ADMIN)
  @Get('fee-invoices')
  listInvoices(
    @Query('status') status?: InvoiceStatus,
    @Query('studentId') studentId?: string,
    @Query('period') period?: string,
  ) {
    return this.svc.listInvoices(status, studentId, period);
  }

  @Roles(Role.STUDENT)
  @Get('me/invoices')
  myInvoices(@CurrentUser() user: AuthUser) {
    return this.svc.invoicesForStudentUser(user.id);
  }

  @Roles(Role.PARENT)
  @Get('me/children/invoices')
  childInvoices(@CurrentUser() user: AuthUser) {
    return this.svc.invoicesForParentUser(user.id);
  }

  @Roles(Role.ADMIN)
  @Post('fee-invoices/:id/payments')
  recordPayment(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: RecordFeePaymentDto,
  ) {
    return this.svc.recordPayment(id, user, dto);
  }

  @Roles(Role.ADMIN)
  @Post('fee-invoices/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.svc.cancelInvoice(id);
  }
}
