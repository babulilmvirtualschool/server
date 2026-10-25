import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** PDF2 Teacher 2 "Give Grade (Marks, Digital Stars, Smilies or imogies)". */
export const GRADE_EMOJIS = ['🌟', '💯', '👏', '👍', '😊', '🙂', '😐', '😟'] as const;

export class AttachmentDto {
  @ApiProperty()
  @IsString()
  key!: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  size?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mime?: string;
}

export class CreateAssignmentDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lessonId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  topicId?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  maxMarks!: number;

  @ApiProperty()
  @IsDateString()
  dueDate!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  allowLate?: boolean;

  @ApiPropertyOptional({ default: true, description: 'false = save as draft (students do not see it)' })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({ type: [AttachmentDto], description: "The teacher's own ASSIGNMENT_ATTACHMENT uploads (max 10)" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];
}

export class UpdateAssignmentDto extends PartialType(CreateAssignmentDto) {}

export class SubmitAssignmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  textAnswer?: string;

  @ApiPropertyOptional({ type: [AttachmentDto], description: 'Own ASSIGNMENT_SUBMISSION uploads (max 10)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];
}

/** Marks, digital stars and / or an emoji — at least one. */
export class GradeSubmissionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  marksObtained?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  stars?: number;

  @ApiPropertyOptional({ enum: GRADE_EMOJIS })
  @IsOptional()
  @IsIn(GRADE_EMOJIS as unknown as string[])
  emoji?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  feedback?: string;
}

/** Teacher's assignment list (PDF2 Teacher 2 "filter class, filter subject, create date, submit date"). */
export class MyAssignmentsQueryDto {
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
  subjectId?: string;

  @ApiPropertyOptional({ description: 'Created on or after (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'Created on or before (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @ApiPropertyOptional({ description: 'Due on or after (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  dueFrom?: string;

  @ApiPropertyOptional({ description: 'Due on or before (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  dueTo?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISHED'])
  status?: 'DRAFT' | 'PUBLISHED';
}
