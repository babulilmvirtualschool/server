import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DayOfWeek } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches } from 'class-validator';

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

export class CreateTimetableSlotDto {
  @ApiProperty()
  @IsString()
  courseId!: string;

  @ApiProperty({ enum: DayOfWeek })
  @IsEnum(DayOfWeek)
  dayOfWeek!: DayOfWeek;

  @ApiProperty({ example: '08:00' })
  @IsString()
  @Matches(TIME_RE, { message: 'startTime must be HH:mm (24h)' })
  startTime!: string;

  @ApiProperty({ example: '08:45' })
  @IsString()
  @Matches(TIME_RE, { message: 'endTime must be HH:mm (24h)' })
  endTime!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  room?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;
}

export class UpdateTimetableSlotDto {
  @ApiPropertyOptional({ enum: DayOfWeek })
  @IsOptional()
  @IsEnum(DayOfWeek)
  dayOfWeek?: DayOfWeek;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @IsString()
  @Matches(TIME_RE, { message: 'startTime must be HH:mm (24h)' })
  startTime?: string;

  @ApiPropertyOptional({ example: '08:45' })
  @IsOptional()
  @IsString()
  @Matches(TIME_RE, { message: 'endTime must be HH:mm (24h)' })
  endTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  room?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
