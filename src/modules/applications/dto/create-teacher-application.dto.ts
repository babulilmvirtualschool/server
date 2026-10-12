import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Campus } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

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

  @ApiProperty({ description: 'e.g. Mathematics, Urdu' })
  @IsString()
  @MinLength(1)
  subjectExpertise!: string;

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
}
