import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { PeriodAttendanceController } from './period-attendance.controller';
import { PeriodAttendanceService } from './period-attendance.service';
import { TimetableController } from './timetable.controller';
import { TimetableService } from './timetable.service';

@Module({
  imports: [AttendanceModule],
  controllers: [TimetableController, PeriodAttendanceController],
  providers: [TimetableService, PeriodAttendanceService],
  exports: [TimetableService],
})
export class TimetableModule {}
