import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Same rule as `username.util.ts` — keep in sync for admin PATCH validation. */
const USERNAME_RE = /^[a-z0-9][a-z0-9._]{2,31}$/i;

export class UpdateAdmissionStatusDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'], {
    message: 'status must be APPROVED or REJECTED',
  })
  status!: 'APPROVED' | 'REJECTED';

  /** When creating LMS accounts on first-time approval. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Student password must be at least 8 characters' })
  studentPassword?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Father account password must be at least 8 characters' })
  fatherPassword?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Mother account password must be at least 8 characters' })
  motherPassword?: string;

  @ApiPropertyOptional({
    description: 'Login name for the student user (LMS). Required when accounts are created.',
  })
  @IsOptional()
  @IsString()
  @Matches(USERNAME_RE, {
    message:
      'Student username: 3–32 characters; start with a letter or digit, then letters, digits, dots, or underscores.',
  })
  studentUsername?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(USERNAME_RE, {
    message:
      'Father username: 3–32 characters; start with a letter or digit, then letters, digits, dots, or underscores.',
  })
  fatherUsername?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(USERNAME_RE, {
    message:
      'Mother username: 3–32 characters; start with a letter or digit, then letters, digits, dots, or underscores.',
  })
  motherUsername?: string;

  @ApiPropertyOptional({
    description: 'Optional. Stored on the student user; login is by username.',
  })
  @ValidateIf(
    (o) => o.studentEmail != null && String(o.studentEmail).trim() !== '',
  )
  @IsEmail({}, { message: 'Invalid student email' })
  studentEmail?: string;
}
