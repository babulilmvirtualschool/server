import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceRulesService } from './attendance-rules.service';
import { AttendanceService } from './attendance.service';
import { AttendanceSettingsController } from './attendance-settings.controller';

@Module({
  controllers: [AttendanceController, AttendanceSettingsController],
  providers: [AttendanceService, AttendanceRulesService],
  exports: [AttendanceService, AttendanceRulesService],
})
export class AttendanceModule {}
