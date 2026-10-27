import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { BankQuestionType, QuestionDifficulty } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** PDF1 12.1 blueprint row: "Chapter 1: 5 MCQs [Easy] of 1 mark". */
export class PatternRowDto {
  @ApiPropertyOptional({ description: 'Chapter number (empty = any of the paper\'s chapters)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  chapterNo?: number;

  @ApiProperty({ enum: BankQuestionType })
  @IsEnum(BankQuestionType)
  type!: BankQuestionType;

  @ApiPropertyOptional({ enum: QuestionDifficulty, description: 'Empty = any difficulty' })
  @IsOptional()
  @IsEnum(QuestionDifficulty)
  difficulty?: QuestionDifficulty;

  @ApiProperty({ minimum: 1, maximum: 50 })
  @IsInt()
  @Min(1)
  @Max(50)
  count!: number;

  @ApiProperty({ description: 'Marks for each question of this row' })
  @IsNumber()
  @Min(0.5)
  @Max(100)
  marks!: number;
}

export class PaperHeaderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  schoolName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  examName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  totalMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalMarks?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  instructions?: string;
}

export class CreatePaperPatternDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty()
  @IsString()
  subjectId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  className?: string;

  @ApiPropertyOptional({ type: [Number], description: 'Chapters included' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  chapters?: number[];

  @ApiProperty({ type: [PatternRowDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => PatternRowDto)
  rows!: PatternRowDto[];

  @ApiPropertyOptional({ type: PaperHeaderDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PaperHeaderDto)
  header?: PaperHeaderDto;
}

export class UpdatePaperPatternDto extends PartialType(OmitType(CreatePaperPatternDto, ['subjectId'] as const)) {}

export class PaperLayoutDto {
  @ApiPropertyOptional({ enum: ['ALPHA', 'ROMAN'], description: 'Sub-parts (a)(b)(c) or (i)(ii)(iii)' })
  @IsOptional()
  @IsIn(['ALPHA', 'ROMAN'])
  numbering?: 'ALPHA' | 'ROMAN';

  @ApiPropertyOptional({ enum: ['ROW', 'GRID'], description: 'MCQ options in one row or a 2x2 grid' })
  @IsOptional()
  @IsIn(['ROW', 'GRID'])
  options?: 'ROW' | 'GRID';
}

/** PDF1 12.1 paper title / header + 12.3 layout. */
export class CreateQuestionPaperDto extends PaperHeaderDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @ApiProperty()
  @IsString()
  subjectId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  className?: string;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  chapters?: number[];

  @ApiPropertyOptional({ type: PaperLayoutDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PaperLayoutDto)
  layout?: PaperLayoutDto;

  @ApiPropertyOptional({ enum: ['DRAFT', 'FINAL'] })
  @IsOptional()
  @IsIn(['DRAFT', 'FINAL'])
  status?: 'DRAFT' | 'FINAL';
}

export class UpdateQuestionPaperDto extends PartialType(OmitType(CreateQuestionPaperDto, ['subjectId'] as const)) {}

export class PaperItemDto {
  @ApiProperty()
  @IsString()
  questionId!: string;

  @ApiPropertyOptional({ description: 'Marks on this paper (default: the question\'s marks)' })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(100)
  marks?: number;
}

/** PDF1 12.2 Mode 2 (manual): the paper's questions, in order. */
export class SetPaperItemsDto {
  @ApiProperty({ type: [PaperItemDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PaperItemDto)
  items!: PaperItemDto[];
}

/** PDF1 12.2 Mode 1 (automatic): pull questions matching each blueprint row. */
export class GeneratePaperDto {
  @ApiProperty({ type: [PatternRowDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => PatternRowDto)
  rows!: PatternRowDto[];

  @ApiPropertyOptional({ description: 'Keep the questions already on the paper and add to them' })
  @IsOptional()
  @IsBoolean()
  append?: boolean;
}

export class ListQuestionPapersDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subjectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  className?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'FINAL'] })
  @IsOptional()
  @IsIn(['DRAFT', 'FINAL'])
  status?: 'DRAFT' | 'FINAL';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}
