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
