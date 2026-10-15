import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { PaginationDto } from '../../../common/pagination/pagination.dto';

export const RELIGIONS = ['Islam', 'Christianity', 'Hinduism', 'Sikhism', 'Other'] as const;

/** Set or remove a photo: the key of a finished AVATAR upload, or null to remove. */
export class SetPhotoDto {
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((o) => o.avatarKey !== null)
  @IsString()
  @MaxLength(500)
  avatarKey!: string | null;
}

export class DischargeStudentsDto {
  @ApiProperty({ type: [String], description: 'User ids of the students' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  studentIds!: string[];

  @ApiProperty({ example: '2026-10-15' })
  @IsDateString()
  leavingDate!: string;

  @ApiProperty() @IsString() @MaxLength(300) reason!: string;
  @ApiPropertyOptional({ example: 'Good' }) @IsOptional() @IsString() @MaxLength(100) conduct?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) remarks?: string;
}

export class ReadmitStudentDto {
  @ApiProperty() @IsString() sectionId!: string;
  @ApiProperty() @IsString() @MaxLength(30) rollNumber!: string;
}

export class ListDischargedDto extends PaginationDto {}
