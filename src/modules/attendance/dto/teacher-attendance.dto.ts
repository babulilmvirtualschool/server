import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AttendanceApprovalStatus,
  TeacherAttendanceStatus,
} from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class MarkTeacherAttendanceDto {
  @ApiProperty({ example: '2026-06-13' })
  @IsDateString()
  date!: string;

  @ApiProperty({ enum: ['PRESENT', 'LATE', 'ABSENT'] })
  @IsIn(['PRESENT', 'LATE', 'ABSENT'], {
    message: 'status must be PRESENT, LATE or ABSENT (use a leave request for leave)',
  })
  status!: TeacherAttendanceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  remarks?: string;

  @ApiPropertyOptional({ example: '08:40', description: 'Arrival time; Present/Late is then decided by the timing + late threshold' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'arrivalTime must be HH:mm' })
  arrivalTime?: string;
}

export class ListTeacherAttendanceDto {
  @ApiPropertyOptional({ enum: AttendanceApprovalStatus })
  @IsOptional()
  @IsEnum(AttendanceApprovalStatus)
  approvalStatus?: AttendanceApprovalStatus;

  @ApiPropertyOptional({ description: 'TeacherProfile.id' })
  @IsOptional()
  @IsString()
  teacherId?: string;

  @ApiPropertyOptional({ example: '2026-06-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-06-30' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ReviewTeacherAttendanceDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'], {
    message: 'status must be APPROVED or REJECTED',
  })
  status!: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reviewNote?: string;
}
