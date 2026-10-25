import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MSG = 'must be a date in YYYY-MM-DD format';

export class UpsertDiaryEntryDto {
  @ApiProperty()
  @IsString()
  courseId!: string;

  @ApiProperty({ example: '2026-10-08' })
  @Matches(DAY_RE, { message: `date ${DAY_MSG}` })
  date!: string;

  @ApiProperty({ description: "The day's classwork / homework" })
  @IsString()
  @IsNotEmpty({ message: 'Diary text is required' })
  @MaxLength(5000)
  content!: string;
}

export class DiaryDayQueryDto {
  @ApiProperty({ example: '2026-10-08' })
  @Matches(DAY_RE, { message: `date ${DAY_MSG}` })
  date!: string;
}

export class DiaryRangeQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DAY_RE, { message: `from ${DAY_MSG}` })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Matches(DAY_RE, { message: `to ${DAY_MSG}` })
  to?: string;
}

class DiaryFileDto {
  @ApiProperty()
  @IsString()
  key!: string;

  @ApiProperty()
  @IsString()
  name!: string;
}

/** PDF2 Student 1: the student's homework for a diary entry (text and / or image, PDF, Word, PPT files). */
export class SubmitDiaryHomeworkDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  text?: string;

  @ApiPropertyOptional({ type: [DiaryFileDto], description: 'Own ASSIGNMENT_SUBMISSION uploads (max 10)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => DiaryFileDto)
  attachments?: DiaryFileDto[];
}

/** PDF2 Teacher 8: diary checked, grade or digital stars, teacher remarks. */
export class CheckDiaryHomeworkDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  checked?: boolean;

  @ApiPropertyOptional({ example: 'A+' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  grade?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  stars?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

export class MyDiaryHomeworkQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DAY_RE, { message: `from ${DAY_MSG}` })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Matches(DAY_RE, { message: `to ${DAY_MSG}` })
  to?: string;
}
