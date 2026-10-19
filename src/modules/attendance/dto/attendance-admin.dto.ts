import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TeacherAttendanceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class StaffAttendanceEntryDto {
  @ApiProperty({ description: 'TeacherProfile.id' })
  @IsString()
  teacherId!: string;

  @ApiProperty({ enum: TeacherAttendanceStatus })
  @IsEnum(TeacherAttendanceStatus)
  status!: TeacherAttendanceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;

  @ApiPropertyOptional({ example: '08:40', description: 'Arrival time; Present/Late is then decided by the timing + late threshold' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'arrivalTime must be HH:mm' })
  arrivalTime?: string;
}

/** Admin marks staff attendance for one date; recorded as approved. */
export class BulkStaffAttendanceDto {
  @ApiProperty({ example: '2026-10-10' })
  @IsDateString()
  date!: string;

  @ApiProperty({ type: [StaffAttendanceEntryDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => StaffAttendanceEntryDto)
  entries!: StaffAttendanceEntryDto[];
}

/** Monthly attendance grid: one month ("YYYY-MM"); sectionId for the student grid. */
export class MonthGridQueryDto {
  @ApiProperty({ example: '2026-10' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' })
  month!: string;

  @ApiPropertyOptional({ description: 'Class section (student grid)' })
  @IsOptional()
  @IsString()
  sectionId?: string;
}

/** Admin — student attendance records for reports. */
export class AttendanceRecordsQueryDto {
  @ApiProperty({ example: '2026-10-01' })
  @IsDateString()
  from!: string;

  @ApiProperty({ example: '2026-10-31' })
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({ description: 'Class/section' })
  @IsOptional()
  @IsString()
  sectionId?: string;

  @ApiPropertyOptional({ description: 'Subject period (course)' })
  @IsOptional()
  @IsString()
  courseId?: string;

  @ApiPropertyOptional({ description: 'StudentProfile.id' })
  @IsOptional()
  @IsString()
  studentId?: string;

  @ApiPropertyOptional({ enum: ['DAILY', 'PERIOD'], description: 'DAILY = class (homeroom) attendance, PERIOD = subject attendance' })
  @IsOptional()
  @IsIn(['DAILY', 'PERIOD'])
  kind?: 'DAILY' | 'PERIOD';
}
