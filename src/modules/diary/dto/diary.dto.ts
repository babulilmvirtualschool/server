import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
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
