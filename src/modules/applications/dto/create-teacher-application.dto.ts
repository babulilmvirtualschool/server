import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Campus, StaffType } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class CreateTeacherApplicationDto {
  @ApiPropertyOptional({
    enum: Campus,
    description: 'Website form: Online or Physical school (default ONLINE). On admin routes the admin\'s school is used.',
  })
  @IsOptional()
  @IsEnum(Campus)
  campus?: Campus;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  lastName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  phone!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  city!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  cnic!: string;

  @ApiPropertyOptional({ enum: StaffType, description: 'Teaching (default) or Non-teaching job; non-teaching becomes a STAFF account on approval.' })
  @IsOptional()
  @IsEnum(StaffType)
  staffType?: StaffType;

  @ApiPropertyOptional({ description: 'Job title — required for non-teaching (e.g. Accountant, Guard)' })
  @ValidateIf((o) => o.staffType === StaffType.NON_TEACHING)
  @IsString()
  @MinLength(2, { message: 'Enter the job title' })
  @MaxLength(80)
  designation?: string;

  @ApiPropertyOptional({ description: 'e.g. Mathematics, Urdu — required for teaching applications' })
  @ValidateIf((o) => o.staffType !== StaffType.NON_TEACHING || o.subjectExpertise != null)
  @IsString()
  @MinLength(1)
  subjectExpertise?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  highestQualification!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  teachingExperience!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currentWorkplace?: string;

  @ApiPropertyOptional({
    description: 'R2 key from POST /applications/teachers/cv-presign upload.',
  })
  @IsOptional()
  @IsString()
  cvKey?: string;

  @ApiPropertyOptional({
    description: 'Original CV filename.',
  })
  @IsOptional()
  @IsString()
  cvOriginalName?: string;

  @ApiPropertyOptional({ description: 'Optional photo: key from POST applications/uploads/presign (kind TEACHER_PHOTO).' })
  @IsOptional()
  @IsString()
  @Matches(/^applications\/uploads\/teacher-photo\/[\w.-]+$/, { message: 'Invalid photo upload' })
  photoKey?: string;
}
