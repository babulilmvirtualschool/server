import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import { IsDateString, IsEmail, IsEnum, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/** Admin "Edit student": the full Add-student form without logins. Parents are updated through the student's links. */
export class UpdateStudentRecordDto {
  @ApiProperty() @IsString() @MaxLength(80) firstName!: string;
  @ApiProperty() @IsString() @MaxLength(80) lastName!: string;
  @ApiProperty() @IsString() @MaxLength(30) phone!: string;

  @ApiPropertyOptional()
  @ValidateIf((o) => o.studentAccountEmail != null && String(o.studentAccountEmail).trim() !== '')
  @IsEmail()
  studentAccountEmail?: string;

  @ApiProperty() @IsString() @MaxLength(120) city!: string;
  @ApiProperty() @IsDateString() dateOfBirth!: string;
  @ApiPropertyOptional({ enum: Gender }) @IsOptional() @IsEnum(Gender) gender?: Gender;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) bloodGroup?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) curriculum?: string;
  @ApiPropertyOptional({ enum: ['morning', 'evening'] }) @IsOptional() @IsIn(['morning', 'evening']) preferredShift?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) studentBFormNo?: string;
  @ApiPropertyOptional({ enum: ['Islam', 'Christianity', 'Hinduism', 'Sikhism', 'Other'] })
  @IsOptional()
  @IsIn(['Islam', 'Christianity', 'Hinduism', 'Sikhism', 'Other'])
  religion?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) fatherName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) fatherCnic?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) fatherPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) motherName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) motherCnic?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) motherPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) guardianName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) guardianRelation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) guardianPhone?: string;

  @ApiPropertyOptional({ description: 'Class/section for the current year (with rollNumber). Leave both empty to keep the enrollment as is.' })
  @IsOptional()
  @IsString()
  sectionId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) rollNumber?: string;
}
