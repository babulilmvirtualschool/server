import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender, ParentRelation } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
  MaxLength,
} from 'class-validator';

export class BaseCreateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty()
  @IsString()
  firstName!: string;

  @ApiProperty()
  @IsString()
  lastName!: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatarKey?: string;
}

export class CreateAdminDto extends BaseCreateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Main admin: access to both schools (only a main admin can grant it).' })
  @IsOptional()
  @IsBoolean()
  allCampuses?: boolean;
}

export class CreateTeacherDto extends BaseCreateUserDto {
  @ApiProperty()
  @IsString()
  employeeCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  qualification?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialization?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  joiningDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cnic?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: '2-5 Years Online' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  teachingExperience?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentWorkplace?: string;

  @ApiPropertyOptional({ description: 'Key returned by POST /media/presign-upload (after finalize)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cvKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  cvOriginalName?: string;
}

/** Non-teaching staff (role STAFF): job title required; employee code auto (STF00001…) when left empty. */
export class CreateStaffDto extends BaseCreateUserDto {
  @ApiProperty({ example: 'Accountant' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  designation!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  employeeCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  qualification?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  joiningDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cnic?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: '2-5 Years' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  teachingExperience?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;
}

/** A certificate the admin uploads for a staff member (key from media presign-upload + finalize, purpose OTHER). */
export class AddCertificateDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  key!: string;

  @ApiProperty({ example: 'B.Ed degree' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;
}

export class CreateStudentDto extends BaseCreateUserDto {
  @ApiProperty()
  @IsString()
  admissionNo!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  admissionDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bloodGroup?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emergencyPhone?: string;
}

export class ParentChildLinkDto {
  @ApiProperty()
  @IsString()
  studentId!: string;

  @ApiProperty({ enum: ParentRelation })
  @IsEnum(ParentRelation)
  relation!: ParentRelation;

  @ApiPropertyOptional()
  @IsOptional()
  isPrimary?: boolean;
}

export class CreateParentDto extends BaseCreateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  occupation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cnic?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ type: [ParentChildLinkDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParentChildLinkDto)
  children?: ParentChildLinkDto[];
}
