import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { ExamType } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateExamDto {
  @ApiProperty()
  @IsString()
  academicYearId!: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty({ enum: ExamType })
  @IsEnum(ExamType)
  type!: ExamType;

  @ApiProperty()
  @IsDateString()
  startDate!: string;

  @ApiProperty()
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  published?: boolean;
}

export class UpdateExamDto extends PartialType(CreateExamDto) {}

export class CreateExamPaperDto {
  @ApiProperty()
  @IsString()
  courseId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  quizId?: string;

  @ApiProperty()
  @IsDateString()
  scheduledAt!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  durationMinutes!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  maxMarks!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  venue?: string;
}

/** Re-schedule a paper on the date sheet (subject/course cannot change). */
export class UpdateExamPaperDto extends PartialType(
  OmitType(CreateExamPaperDto, ['courseId', 'quizId'] as const),
) {}

/** Paper generator: the ordered list of question-bank question ids that make up the paper. */
export class SetPaperQuestionsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  questionIds!: string[];
}

export class RecordExamResultDto {
  @ApiProperty()
  @IsString()
  studentId!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  marksObtained!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  grade?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  remarks?: string;
}
