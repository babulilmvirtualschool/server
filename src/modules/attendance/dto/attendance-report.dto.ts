import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString } from 'class-validator';

export class AttendanceReportQueryDto {
  @ApiProperty()
  @IsString()
  courseId!: string;

  @ApiProperty({ example: '2026-06-13' })
  @IsDateString()
  date!: string;
}
