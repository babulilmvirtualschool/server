import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateAdmissionApplicationDto {
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
}
