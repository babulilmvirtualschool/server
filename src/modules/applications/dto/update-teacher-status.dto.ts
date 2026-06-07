import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

/** Keep in sync with `username.util.ts` / admission PATCH. */
const USERNAME_RE = /^[a-z0-9][a-z0-9._]{2,31}$/i;

export class UpdateTeacherApplicationStatusDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'], {
    message: 'status must be APPROVED or REJECTED',
  })
  status!: 'APPROVED' | 'REJECTED';

  /** Required on first-time approve when creating the LMS teacher account. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  teacherPassword?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(USERNAME_RE, {
    message:
      'Username: 3–32 characters; start with a letter or digit, then letters, digits, dots, or underscores.',
  })
  teacherUsername?: string;

  @ApiPropertyOptional({ description: 'Unique staff code (e.g. TCH00042).' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  employeeCode?: string;
}
