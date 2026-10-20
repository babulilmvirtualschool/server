import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DayOfWeek, TeacherAttendanceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** A period slot of the school day (Period 1 08:00–08:40, Break, …). */
export class SaveTimetablePeriodDto {
  @ApiProperty({ example: 'Period 1' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @ApiProperty({ example: '08:00' })
  @Matches(TIME_RE, { message: 'startTime must be HH:mm (24h)' })
  startTime!: string;

  @ApiProperty({ example: '08:40' })
  @Matches(TIME_RE, { message: 'endTime must be HH:mm (24h)' })
  endTime!: string;

  @ApiPropertyOptional({ description: 'Break / lunch — no classes are placed in it' })
  @IsOptional()
  @IsBoolean()
  isBreak?: boolean;
}

/** Auto-Generate Timetable for some classes: their courses' weekly hours spread over the periods and days. */
export class AutoGenerateTimetableDto {
  @ApiProperty({ type: [String], description: 'Section ids to (re)generate' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  sectionIds!: string[];

  @ApiPropertyOptional({ enum: DayOfWeek, isArray: true, description: 'Default: the open days of the attendance settings (Mon–Sat)' })
  @IsOptional()
  @IsArray()
  @IsEnum(DayOfWeek, { each: true })
  days?: DayOfWeek[];

  @ApiPropertyOptional({ description: 'false (default) = preview only; true = replace these classes\' timetables' })
  @IsOptional()
  @IsBoolean()
  apply?: boolean;
}

export class PeriodAttendanceEntryDto {
  @ApiProperty()
  @IsString()
  slotId!: string;

  @ApiProperty({ enum: TeacherAttendanceStatus })
  @IsEnum(TeacherAttendanceStatus)
  status!: TeacherAttendanceStatus;

  @ApiPropertyOptional({ description: 'TeacherProfile.id of the substitute (only when Absent / Leave)' })
  @IsOptional()
  @IsString()
  substituteTeacherId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}

/** Admin — period-wise teacher attendance for one date. */
export class BulkPeriodAttendanceDto {
  @ApiProperty({ example: '2026-10-20' })
  @IsDateString()
  date!: string;

  @ApiProperty({ type: [PeriodAttendanceEntryDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PeriodAttendanceEntryDto)
  entries!: PeriodAttendanceEntryDto[];
}

/** Teacher — leave from one period on one date. */
export class CreatePeriodLeaveDto {
  @ApiProperty()
  @IsString()
  slotId!: string;

  @ApiProperty({ example: '2026-10-21' })
  @IsDateString()
  date!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

/** Admin — approve (with a substitute) or reject (with a reason); can be changed again later. */
export class ReviewPeriodLeaveDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'], { message: 'status must be APPROVED or REJECTED' })
  status!: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({ description: 'Required to approve: TeacherProfile.id of the substitute' })
  @IsOptional()
  @IsString()
  substituteTeacherId?: string;

  @ApiPropertyOptional({ description: 'Required to reject: the reason' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reviewNote?: string;
}

export class PeriodLeavesQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export class PeriodDateQueryDto {
  @ApiProperty({ example: '2026-10-20' })
  @IsDateString()
  date!: string;
}

export class RangeQueryDto {
  @ApiPropertyOptional({ example: '2026-10-20' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-03' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

/** Period-wise teacher attendance report (max 62 days). */
export class PeriodReportQueryDto {
  @ApiProperty({ example: '2026-10-01' })
  @IsDateString()
  from!: string;

  @ApiProperty({ example: '2026-10-31' })
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({ description: 'TeacherProfile.id' })
  @IsOptional()
  @IsString()
  teacherId?: string;

  @ApiPropertyOptional({ description: 'Class section' })
  @IsOptional()
  @IsString()
  sectionId?: string;

  @ApiPropertyOptional({ description: 'TimetablePeriod.id' })
  @IsOptional()
  @IsString()
  periodId?: string;
}
