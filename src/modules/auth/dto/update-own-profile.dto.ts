import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsString,
  ValidateIf,
} from 'class-validator';

/** Self-service profile update (no role / isActive). */
export class UpdateOwnProfileDto {
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v != null && v !== '')
  @IsEmail()
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  username?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  phone?: string | null;

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  firstName?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ nullable: true, enum: Gender })
  @ValidateIf((_, v) => v != null)
  @IsEnum(Gender)
  gender?: Gender | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v != null && v !== '')
  @IsDateString()
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v != null && v !== '')
  @IsString()
  avatarKey?: string | null;
}
