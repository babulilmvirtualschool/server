import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EnrollmentStatus } from '@prisma/client';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateEnrollmentDto {
  @ApiProperty({ description: 'StudentProfile.id' })
  @IsString()
  studentId!: string;

  @ApiProperty()
  @IsString()
  sectionId!: string;

  @ApiProperty()
  @IsString()
  academicYearId!: string;

  @ApiProperty()
  @IsString()
  rollNumber!: string;

  @ApiPropertyOptional({ enum: EnrollmentStatus })
  @IsOptional()
  @IsEnum(EnrollmentStatus)
  status?: EnrollmentStatus;
}

/** Move students (their current-year enrollment) to another section of the same academic year. */
export class ShiftEnrollmentsDto {
  @ApiProperty({ type: [String], description: 'StudentProfile ids' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  studentIds!: string[];

  @ApiProperty({ description: 'Target section' })
  @IsString()
  sectionId!: string;
}

/** Promote the ticked students of a section to another section (same or next year) with the same roll numbers, or mark them Graduated. */
export class PromoteStudentsDto {
  @ApiProperty({ description: 'Section they are in now' })
  @IsString()
  fromSectionId!: string;

  @ApiProperty({ type: [String], description: 'StudentProfile ids to promote (students left out stay back)' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  studentIds!: string[];

  @ApiPropertyOptional({ description: 'Section of the next class (any academic year). Omit when graduate = true.' })
  @IsOptional()
  @IsString()
  toSectionId?: string;

  @ApiPropertyOptional({ description: 'Final class: mark them Graduated instead of moving them.' })
  @IsOptional()
  @IsBoolean()
  graduate?: boolean;
}

export class UpdateEnrollmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sectionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  rollNumber?: string;

  @ApiPropertyOptional({ enum: EnrollmentStatus })
  @IsOptional()
  @IsEnum(EnrollmentStatus)
  status?: EnrollmentStatus;
}
