import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';

const USERNAME_RE = /^[a-z0-9][a-z0-9._]{2,31}$/i;

/**
 * Admin-only: creates student + father + mother accounts and links them,
 * same as admission approval provisioning (plus optional academic/guardian notes on profile address).
 */
export class CreateStudentWithParentsDto {
  @ApiProperty()
  @IsString()
  firstName!: string;

  @ApiProperty()
  @IsString()
  lastName!: string;

  @ApiProperty()
  @IsString()
  phone!: string;

  @ApiPropertyOptional({
    description: 'Optional; stored on student User when set.',
  })
  @ValidateIf((o) => o.studentAccountEmail != null && String(o.studentAccountEmail).trim() !== '')
  @IsEmail()
  studentAccountEmail?: string;

  @ApiProperty({ description: 'Residential city (stored as primary line of student address).' })
  @IsString()
  city!: string;

  @ApiProperty({ description: 'Student date of birth (ISO date string)' })
  @IsDateString()
  dateOfBirth!: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bloodGroup?: string;

  @ApiProperty({ description: 'Class / grade level (e.g. Playgroup, 3rd)' })
  @IsString()
  gradeLevel!: string;

  @ApiProperty()
  @IsString()
  curriculum!: string;

  @ApiProperty({ description: 'morning | evening' })
  @IsString()
  @IsIn(['morning', 'evening'], { message: 'preferredShift must be morning or evening' })
  preferredShift!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  studentBFormNo?: string;

  @ApiProperty()
  @IsString()
  fatherName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fatherCnic?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fatherPhone?: string;

  @ApiProperty()
  @IsString()
  motherName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  motherCnic?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  motherPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  guardianName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  guardianRelation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  guardianPhone?: string;

  @ApiProperty({ description: 'Login username for the student account' })
  @IsString()
  @Matches(USERNAME_RE, {
    message:
      'Student username: 3–32 characters; start with a letter or digit.',
  })
  studentUsername!: string;

  @ApiProperty()
  @IsString()
  @Matches(USERNAME_RE, { message: 'Father username: invalid format.' })
  fatherUsername!: string;

  @ApiProperty()
  @IsString()
  @Matches(USERNAME_RE, { message: 'Mother username: invalid format.' })
  motherUsername!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  studentPassword!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  fatherPassword!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  motherPassword!: string;
}
