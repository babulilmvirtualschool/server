import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { ExamPaperMode, ExamType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsIn,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PaperFileDto {
  @ApiProperty()
  @IsString()
  key!: string;

  @ApiProperty()
  @IsString()
  name!: string;
}

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

  @ApiPropertyOptional({ description: 'Exam / test title (default: exam name + subject)' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional({ enum: ExamPaperMode, description: 'MANUAL = paper on paper / file; ONLINE = online test (a quiz is created for it)' })
  @IsOptional()
  @IsEnum(ExamPaperMode)
  mode?: ExamPaperMode;

  @ApiPropertyOptional({ description: 'Passing percentage 0–100' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  passingPercent?: number;

  @ApiPropertyOptional({ description: 'Weightage % for the final result compilation' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  weightage?: number;

  @ApiPropertyOptional({ example: 'MTH-10A' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  paperCode?: string;

  @ApiPropertyOptional({ description: 'TeacherProfile id of the invigilator / duty teacher ("" clears it)' })
  @IsOptional()
  @IsString()
  invigilatorId?: string;

  @ApiPropertyOptional({ description: 'Text shown to students with the paper' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  instructions?: string;

  @ApiPropertyOptional({ type: PaperFileDto, description: 'Question paper file (own CONTENT_DOCUMENT upload); null removes it' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PaperFileDto)
  paperFile?: PaperFileDto | null;
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

/** PDF1 10.1 filters: course, class, exam type, status (Upcoming / Active / Completed), dates. */
export class ListExamPapersQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  academicYearId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  examId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  courseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sectionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  classId?: string;

  @ApiPropertyOptional({ enum: ExamType })
  @IsOptional()
  @IsEnum(ExamType)
  examType?: ExamType;

  @ApiPropertyOptional({ enum: ExamPaperMode })
  @IsOptional()
  @IsEnum(ExamPaperMode)
  mode?: ExamPaperMode;

  @ApiPropertyOptional({ enum: ['UPCOMING', 'ACTIVE', 'COMPLETED'] })
  @IsOptional()
  @IsIn(['UPCOMING', 'ACTIVE', 'COMPLETED'])
  status?: 'UPCOMING' | 'ACTIVE' | 'COMPLETED';

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Teachers: only my own courses' })
  @IsOptional()
  @IsIn(['true', 'false'])
  mine?: 'true' | 'false';
}

/** PDF1 10.1 "Duplicate Exam": copy a paper (and its online test questions) to another class / time. */
export class DuplicateExamPaperDto {
  @ApiProperty({ description: 'Course (class + subject) to copy to' })
  @IsString()
  courseId!: string;

  @ApiPropertyOptional({ description: 'Exam session to copy into (default: the same one)' })
  @IsOptional()
  @IsString()
  examId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
