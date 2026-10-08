import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { BankQuestionType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
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

export class CreateBankQuestionDto {
  @ApiProperty()
  @IsString()
  subjectId!: string;

  @ApiProperty({ enum: BankQuestionType })
  @IsEnum(BankQuestionType)
  type!: BankQuestionType;

  @ApiProperty({ description: 'For FILL_BLANK, mark the blank with ____' })
  @IsString()
  @IsNotEmpty({ message: 'Question text is required' })
  @MaxLength(2000)
  text!: string;

  @ApiPropertyOptional({ type: [BankOptionDto], description: 'MCQ only: 2–6 options, exactly one correct' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => BankOptionDto)
  options?: BankOptionDto[];

  @ApiPropertyOptional({ description: 'FILL_BLANK only: the expected answer' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  answer?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  marks?: number;
}

/** Subject is fixed once created (papers rely on it). */
export class UpdateBankQuestionDto extends PartialType(
  OmitType(CreateBankQuestionDto, ['subjectId'] as const),
) {}

export class ListBankQuestionsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subjectId?: string;

  @ApiPropertyOptional({ enum: BankQuestionType })
  @IsOptional()
  @IsEnum(BankQuestionType)
  type?: BankQuestionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}
