import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConductPeriod, ConductRating } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsEnum, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/** The rated items of the PDF table (Student, Discipline … Overall, Teacher remarks). */
export const CONDUCT_ITEMS = ['discipline', 'regularity', 'punctuality', 'obedience', 'followingInstructions', 'homework', 'learning', 'overall'] as const;

export class ConductSheetQueryDto {
  @ApiProperty()
  @IsString()
  sectionId!: string;

  @ApiProperty({ enum: ConductPeriod })
  @IsEnum(ConductPeriod)
  period!: ConductPeriod;

  @ApiProperty({ example: '2026-10-26' })
  @IsDateString()
  startDate!: string;
}

export class ConductRowDto {
  @ApiProperty({ description: 'StudentProfile id' })
  @IsString()
  studentId!: string;

  @ApiPropertyOptional({ enum: ConductRating }) @IsOptional() @IsEnum(ConductRating) discipline?: ConductRating;
  @ApiPropertyOptional({ enum: ConductRating }) @IsOptional() @IsEnum(ConductRating) regularity?: ConductRating;
  @ApiPropertyOptional({ enum: ConductRating }) @IsOptional() @IsEnum(ConductRating) punctuality?: ConductRating;
  @ApiPropertyOptional({ enum: ConductRating }) @IsOptional() @IsEnum(ConductRating) obedience?: ConductRating;
  @ApiPropertyOptional({ enum: ConductRating }) @IsOptional() @IsEnum(ConductRating) followingInstructions?: ConductRating;
  @ApiPropertyOptional({ enum: ConductRating }) @IsOptional() @IsEnum(ConductRating) homework?: ConductRating;
  @ApiPropertyOptional({ enum: ConductRating }) @IsOptional() @IsEnum(ConductRating) learning?: ConductRating;
  @ApiPropertyOptional({ enum: ConductRating }) @IsOptional() @IsEnum(ConductRating) overall?: ConductRating;

  @ApiPropertyOptional({ description: 'Teacher remarks' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

/** Save the assessment sheet of one class for one period. A row with no rating and no remark removes that student's record. */
export class SaveConductSheetDto {
  @ApiProperty()
  @IsString()
  sectionId!: string;

  @ApiProperty({ enum: ConductPeriod })
  @IsEnum(ConductPeriod)
  period!: ConductPeriod;

  @ApiProperty({ example: '2026-10-26' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-11-01' })
  @IsDateString()
  endDate!: string;

  @ApiProperty({ example: '2026-11-01' })
  @IsDateString()
  assessmentDate!: string;

  @ApiProperty({ type: [ConductRowDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ConductRowDto)
  rows!: ConductRowDto[];
}

/** PDF2 Admin 1 history & reports filters: class (grade), period, start from, end. */
export class ListConductDto {
  @ApiPropertyOptional() @IsOptional() @IsString() sectionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() classId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() studentId?: string;
  @ApiPropertyOptional({ enum: ConductPeriod }) @IsOptional() @IsEnum(ConductPeriod) period?: ConductPeriod;
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @IsDateString() to?: string;
}
