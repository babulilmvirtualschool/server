import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CoordinatorCheckKind } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class RangeQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ListVisitsDto extends RangeQueryDto {
  @ApiPropertyOptional({ description: 'TeacherProfile id' })
  @IsOptional()
  @IsString()
  teacherId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sectionId?: string;
}

export class CreateVisitDto {
  @ApiProperty({ example: '2026-10-29' })
  @IsDateString()
  date!: string;

  @ApiProperty()
  @IsString()
  sectionId!: string;

  @ApiPropertyOptional({ example: 'Period 3' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  period?: string;

  @ApiProperty({ description: 'TeacherProfile id' })
  @IsString()
  teacherId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subjectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  observation?: string;

  @ApiProperty({ minimum: 0, maximum: 100, description: 'Punctuality % (stars x 20)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  punctuality!: number;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  lessonDelivery!: number;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  classControl!: number;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  studentEngagement!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  syllabusProgress!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  recommendations?: string;
}

export class UpdateVisitDto extends PartialType(CreateVisitDto) {}

export class CheckItemDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  label!: string;

  @ApiProperty({ enum: ['GOOD', 'AVERAGE', 'POOR'] })
  @IsIn(['GOOD', 'AVERAGE', 'POOR'])
  rating!: 'GOOD' | 'AVERAGE' | 'POOR';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListChecksDto extends RangeQueryDto {
  @ApiPropertyOptional({ enum: CoordinatorCheckKind })
  @IsOptional()
  @IsEnum(CoordinatorCheckKind)
  kind?: CoordinatorCheckKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sectionId?: string;
}

export class CreateCheckDto {
  @ApiProperty({ enum: CoordinatorCheckKind })
  @IsEnum(CoordinatorCheckKind)
  kind!: CoordinatorCheckKind;

  @ApiProperty({ example: '2026-10-29' })
  @IsDateString()
  date!: string;

  @ApiProperty()
  @IsString()
  sectionId!: string;

  @ApiProperty({ type: [CheckItemDto] })
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => CheckItemDto)
  items!: CheckItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  remarks?: string;
}

export class UpdateCheckDto extends PartialType(CreateCheckDto) {}

export class DiaryEntryDto {
  @ApiProperty({ example: '2026-10-26' })
  @IsDateString()
  date!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(5000)
  note!: string;
}

export class WeekQueryDto {
  @ApiProperty({ example: '2026-10-26', description: 'Any date of the week' })
  @IsDateString()
  weekStart!: string;
}

export class SaveWeeklyReportDto extends WeekQueryDto {
  @ApiProperty({ type: [DiaryEntryDto] })
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => DiaryEntryDto)
  entries!: DiaryEntryDto[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) summary?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) achievements?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) concerns?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) nextWeekPlan?: string;
}

export class PerformanceQueryDto extends RangeQueryDto {
  @ApiPropertyOptional({ description: 'TeacherProfile id' })
  @IsOptional()
  @IsString()
  teacherId?: string;
}
