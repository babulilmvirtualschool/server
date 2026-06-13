import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TeacherAttendanceStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class MarkTeacherAttendanceDto {
  @ApiProperty({ example: '2026-06-13' })
  @IsDateString()
  date!: string;

  @ApiProperty({ enum: TeacherAttendanceStatus })
  @IsEnum(TeacherAttendanceStatus)
  status!: TeacherAttendanceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  remarks?: string;
}
