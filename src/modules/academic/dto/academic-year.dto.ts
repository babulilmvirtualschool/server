import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AcademicYearStatus } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAcademicYearDto {
  @ApiProperty({ example: '2025-2026' })
  @IsString()
  name!: string;

  @ApiProperty()
  @IsDateString()
  startDate!: string;

  @ApiProperty()
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;

  @ApiPropertyOptional({ example: '2026-2027', description: 'Year code' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;

  @ApiPropertyOptional({ enum: AcademicYearStatus })
  @IsOptional()
  @IsEnum(AcademicYearStatus)
  status?: AcademicYearStatus;
}

export class UpdateAcademicYearDto extends PartialType(CreateAcademicYearDto) {}
