import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  ChallansQueryDto,
  CollectFeeDto,
  CreateFeeDiscountDto,
  FamiliesQueryDto,
  FamilyChallanDto,
  FeeDiscountsQueryDto,
  FeePreviewQueryDto,
  FeeTypesQueryDto,
  GenerateChallansDto,
  MissingVouchersQueryDto,
  SaveFeeSettingsDto,
  SaveFeeTypeDto,
  SaveSiblingRulesDto,
  SetReminderDto,
  UpdateFeeDiscountDto,
} from './dto/finance.dto';
import { FeeLedgerQueryDto, FeeRegisterQueryDto, FeeReportQueryDto } from './dto/fee-reports.dto';
import { FeeReportsService } from './fee-reports.service';
import { FinanceService } from './finance.service';

/** Finance (admin): fee settings, fee types, discounts, sibling policy, assign fee, challans, collection, fee slips. */
@ApiTags('finance')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller()
export class FinanceController {
  constructor(
    private readonly svc: FinanceService,
    private readonly reports: FeeReportsService,
  ) {}

  @Get('fee-reports')
  feeReport(@Query() q: FeeReportQueryDto) {
    return this.reports.report(q);
  }

  @Get('fee-register')
  feeRegister(@Query() q: FeeRegisterQueryDto) {
    return this.reports.register(q);
  }

  @Get('fee-ledger')
  feeLedger(@Query() q: FeeLedgerQueryDto) {
    return this.reports.ledger(q);
  }

  @Roles(Role.STUDENT, Role.PARENT)
  @Get('me/fee-status')
  feeStatus(@CurrentUser() user: AuthUser) {
    return this.reports.feeStatus(user);
  }

  @Get('fee-settings')
  settings() {
    return this.svc.getSettings();
  }

  @Put('fee-settings')
  saveSettings(@Body() dto: SaveFeeSettingsDto) {
    return this.svc.saveSettings(dto);
  }

  @Get('fee-types')
  feeTypes(@Query() q: FeeTypesQueryDto) {
    return this.svc.listFeeTypes(q);
  }

  @Post('fee-types')
  createFeeType(@Body() dto: SaveFeeTypeDto) {
    return this.svc.createFeeType(dto);
  }

  @Patch('fee-types/:id')
  updateFeeType(@Param('id') id: string, @Body() dto: SaveFeeTypeDto) {
    return this.svc.updateFeeType(id, dto);
  }

  @Delete('fee-types/:id')
  deleteFeeType(@Param('id') id: string) {
    return this.svc.deleteFeeType(id);
  }

  @Get('fee-discounts')
  discounts(@Query() q: FeeDiscountsQueryDto) {
    return this.svc.listDiscounts(q);
  }

  @Post('fee-discounts')
  createDiscounts(@Body() dto: CreateFeeDiscountDto) {
    return this.svc.createDiscounts(dto);
  }

  @Patch('fee-discounts/:id')
  updateDiscount(@Param('id') id: string, @Body() dto: UpdateFeeDiscountDto) {
    return this.svc.updateDiscount(id, dto);
  }

  @Delete('fee-discounts/:id')
  deleteDiscount(@Param('id') id: string) {
    return this.svc.deleteDiscount(id);
  }

  @Get('sibling-rules')
  siblingRules() {
    return this.svc.listSiblingRules();
  }

  @Put('sibling-rules')
  saveSiblingRules(@Body() dto: SaveSiblingRulesDto) {
    return this.svc.saveSiblingRules(dto);
  }

  @Get('fee-families')
  families(@Query() q: FamiliesQueryDto) {
    return this.svc.listFamilies(q);
  }

  /** PDF1 3.3 fee calculation summary for one student and month (nothing saved). */
  @Get('fee-assign/preview')
  preview(@Query() q: FeePreviewQueryDto) {
    return this.svc.calculate(q.studentId, q.period, q.feeTypeIds ? q.feeTypeIds.split(',').filter(Boolean) : null);
  }

  @Post('fee-challans/generate')
  generate(@Body() dto: GenerateChallansDto) {
    return this.svc.generate(dto);
  }

  @Post('fee-challans/family')
  family(@Body() dto: FamilyChallanDto) {
    return this.svc.generateFamily(dto);
  }

  @Get('fee-challans')
  challans(@Query() q: ChallansQueryDto) {
    return this.svc.listChallans(q);
  }

  @Get('fee-challans/missing')
  missing(@Query() q: MissingVouchersQueryDto) {
    return this.svc.missingVouchers(q);
  }

  @Get('fee-challans/family/:familyVoucherNo')
  familyVoucher(@Param('familyVoucherNo') no: string) {
    return this.svc.familyVoucher(no);
  }

  @Get('fee-challans/:id')
  challan(@Param('id') id: string) {
    return this.svc.getChallan(id);
  }

  @Post('fee-challans/:id/regenerate')
  regenerate(@Param('id') id: string) {
    return this.svc.regenerate(id);
  }

  @Patch('fee-challans/:id/reminder')
  reminder(@Param('id') id: string, @Body() dto: SetReminderDto) {
    return this.svc.setReminder(id, dto.reminderDate);
  }

  @Delete('fee-challans/:id')
  remove(@Param('id') id: string) {
    return this.svc.deleteChallan(id);
  }

  @Post('fee-challans/:id/collect')
  collect(@Param('id') id: string, @Body() dto: CollectFeeDto, @CurrentUser() user: AuthUser) {
    return this.svc.collect(id, dto, user);
  }

  @Roles(Role.STUDENT, Role.PARENT)
  @Get('me/fee-challans')
  myChallans(@CurrentUser() user: AuthUser) {
    return this.svc.myChallans(user);
  }

  @Get('fee-slips/:slipNo')
  slip(@Param('slipNo') slipNo: string) {
    return this.svc.feeSlip(slipNo);
  }
}
