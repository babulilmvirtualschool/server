import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Campus } from '@prisma/client';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
  IsIn,
} from 'class-validator';

export class CreateAdmissionApplicationDto {
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

  @ApiPropertyOptional({
    description: 'Optional contact email; students sign in with username once provisioned.',
  })
  @ValidateIf((o) => o.email != null && String(o.email).trim() !== '')
  @IsEmail()
  email?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  city!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fatherName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fatherCnic?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fatherPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  motherName?: string;

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

  @ApiProperty()
  @IsString()
  @MinLength(1)
  gradeLevel!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  curriculum!: string;

  @ApiProperty({ description: 'e.g. morning | evening' })
  @IsString()
  @MinLength(1)
  preferredShift!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  studentBFormNo?: string;

  @ApiPropertyOptional({ enum: ['Islam', 'Christianity', 'Hinduism', 'Sikhism', 'Other'] })
  @IsOptional()
  @IsIn(['Islam', 'Christianity', 'Hinduism', 'Sikhism', 'Other'])
  religion?: string;
}
