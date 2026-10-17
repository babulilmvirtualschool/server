import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AttendanceMode, SchoolShift } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class DayTimingDto {
  @ApiProperty({ enum: WEEKDAYS })
  @IsIn(WEEKDAYS as unknown as string[])
  day!: Weekday;

  @ApiProperty({ description: 'false = closed day' })
  @IsBoolean()
  open!: boolean;

  @ApiProperty({ example: '08:30' })
  @Matches(HHMM, { message: 'Time must be HH:mm' })
  start!: string;

  @ApiProperty({ example: '14:00' })
  @Matches(HHMM, { message: 'Time must be HH:mm' })
  end!: string;
}

const week = () => [IsArray(), ArrayMinSize(7), ArrayMaxSize(7), ValidateNested({ each: true }), Type(() => DayTimingDto)];
function Week(): PropertyDecorator {
  return (target, key) => week().forEach((d) => (d as PropertyDecorator)(target, key));
}

export class WeekSchedulesDto {
  @ApiProperty({ type: [DayTimingDto], description: 'Default timings (also the fallback for classes without a shift)' })
  @Week()
  DEFAULT!: DayTimingDto[];

  @ApiProperty({ type: [DayTimingDto] })
  @Week()
  MORNING!: DayTimingDto[];

  @ApiProperty({ type: [DayTimingDto] })
  @Week()
  EVENING!: DayTimingDto[];
}

export class SaveAttendanceSettingsDto {
  @ApiProperty({ enum: AttendanceMode })
  @IsEnum(AttendanceMode)
  mode!: AttendanceMode;

  @ApiProperty({ example: 25, description: 'Late after start time + this many minutes' })
  @IsInt()
  @Min(0)
  @Max(240)
  lateThresholdMinutes!: number;

  @ApiProperty({ type: WeekSchedulesDto })
  @ValidateNested()
  @Type(() => WeekSchedulesDto)
  schedules!: WeekSchedulesDto;
}

export class SectionShiftDto {
  @ApiProperty()
  @IsString()
  sectionId!: string;

  @ApiPropertyOptional({ enum: SchoolShift, nullable: true, description: 'null = default timings' })
  @IsOptional()
  @IsEnum(SchoolShift)
  shift?: SchoolShift | null;
}

export class SaveSectionShiftsDto {
  @ApiProperty({ type: [SectionShiftDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SectionShiftDto)
  sections!: SectionShiftDto[];
}

export class SaveStaffTimingDto {
  @ApiPropertyOptional({ enum: SchoolShift, nullable: true })
  @IsOptional()
  @IsEnum(SchoolShift)
  shift?: SchoolShift | null;

  @ApiPropertyOptional({ description: 'Empty = the school threshold' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  lateThresholdMinutes?: number | null;

  @ApiProperty({ type: [DayTimingDto] })
  @Week()
  days!: DayTimingDto[];
}

export const CLOSURE_GROUPS = ['STUDENT', 'TEACHER', 'STAFF'] as const;

export class CreateClosureDto {
  @ApiProperty({ example: 'Summer Vacation' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: CLOSURE_GROUPS, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(CLOSURE_GROUPS as unknown as string[], { each: true })
  appliesTo!: string[];

  @ApiProperty({ example: '2026-06-01' })
  @IsDateString()
  fromDate!: string;

  @ApiProperty({ example: '2026-07-31' })
  @IsDateString()
  toDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ClosuresQueryDto {
  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class DayInfoQueryDto {
  @ApiProperty({ example: '2026-10-17' })
  @IsDateString()
  date!: string;

  @ApiPropertyOptional({ description: 'Class section (students); omit for staff' })
  @IsOptional()
  @IsString()
  sectionId?: string;
}
