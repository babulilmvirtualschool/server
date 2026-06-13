import { ApiProperty } from '@nestjs/swagger';
import { LeaveType } from '@prisma/client';
import { IsDateString, IsEnum, IsString, MinLength } from 'class-validator';

export class CreateTeacherLeaveDto {
  @ApiProperty({ enum: LeaveType })
  @IsEnum(LeaveType)
  type!: LeaveType;

  @ApiProperty({ example: '2026-06-15' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-06-17' })
  @IsDateString()
  endDate!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  reason!: string;
}
