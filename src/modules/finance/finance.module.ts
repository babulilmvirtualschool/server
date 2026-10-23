import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { FeeDefaulterInterceptor } from './fee-defaulter.interceptor';
import { FeeReportsService } from './fee-reports.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

@Module({
  controllers: [FinanceController],
  providers: [FinanceService, FeeReportsService, { provide: APP_INTERCEPTOR, useClass: FeeDefaulterInterceptor }],
  exports: [FinanceService],
})
export class FinanceModule {}
