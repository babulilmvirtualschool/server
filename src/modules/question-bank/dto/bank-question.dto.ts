import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
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
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class BankOptionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Option text is required' })
  @MaxLength(500)
  text!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isCorrect?: boolean;
}

/** Sub-part of a question: Q1 -> (a), (b), (c). */
export class BankPartDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Part text is required' })
  @MaxLength(2000)
  text!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  marks?: number;

  @ApiPropertyOptional({ description: 'Answer / solution of this part' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  answer?: string;
}

/** Matching pair: Column A item → its match in Column B. */
export class BankPairDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Column A item is required' })
  @MaxLength(300)
  left!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Column B item is required' })
  @MaxLength(300)
  right!: string;
}

/** The question itself, without the subject (bulk import passes the subject once). */
export class BankQuestionBodyDto {
  @ApiProperty({ enum: BankQuestionType })
  @IsEnum(BankQuestionType)
  type!: BankQuestionType;

  @ApiPropertyOptional({ description: 'Required (MATCHING defaults to "Match Column A with Column B."). For FILL_BLANK, mark the blank with ____' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string;

  @ApiPropertyOptional({ type: [BankOptionDto], description: 'MCQ only: 2–6 options, exactly one correct' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => BankOptionDto)
  options?: BankOptionDto[];

  @ApiPropertyOptional({ description: 'FILL_BLANK answer; TRUE_FALSE / TICK_CROSS "TRUE" | "FALSE"; SHORT / LONG solution key' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  answer?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(100)
  marks?: number;

  @ApiPropertyOptional({ example: 'Grade 5' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  className?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  chapterNo?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  chapterTitle?: string;

  @ApiPropertyOptional({ description: 'Topic / sub-topic' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  topic?: string;

  @ApiPropertyOptional({ enum: QuestionDifficulty, default: QuestionDifficulty.MEDIUM })
  @IsOptional()
  @IsEnum(QuestionDifficulty)
  difficulty?: QuestionDifficulty;

  @ApiPropertyOptional({ description: 'Explanation / hints' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  explanation?: string;

  @ApiPropertyOptional({ type: [BankPartDto], description: 'SHORT / LONG only: sub-parts (a), (b), (c)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => BankPartDto)
  parts?: BankPartDto[];

  @ApiPropertyOptional({ type: [BankPairDto], description: 'MATCHING only: 2–10 pairs in the correct order' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => BankPairDto)
  pairs?: BankPairDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateBankQuestionDto extends BankQuestionBodyDto {
  @ApiProperty()
  @IsString()
  subjectId!: string;
}

/** Subject is fixed once created (papers rely on it). */
export class UpdateBankQuestionDto extends PartialType(
  OmitType(CreateBankQuestionDto, ['subjectId'] as const),
) {}

/** PDF1 11.1 "Bulk Import via Excel/CSV": the web reads the file and sends the rows; nothing is saved if a row is invalid. */
export class BulkBankQuestionsDto {
  @ApiProperty()
  @IsString()
  subjectId!: string;

  @ApiProperty({ type: [BankQuestionBodyDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BankQuestionBodyDto)
  rows!: BankQuestionBodyDto[];
}

/** PDF1 11.1 filters: class, subject, chapter, question type, difficulty, keyword. */
export class ListBankQuestionsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subjectId?: string;

  @ApiPropertyOptional({ enum: BankQuestionType })
  @IsOptional()
  @IsEnum(BankQuestionType)
  type?: BankQuestionType;

  @ApiPropertyOptional({ enum: QuestionDifficulty })
  @IsOptional()
  @IsEnum(QuestionDifficulty)
  difficulty?: QuestionDifficulty;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  className?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  chapterNo?: number;

  @ApiPropertyOptional({ description: 'Keyword in the question, topic or chapter title' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: 'true' | 'false';
}
