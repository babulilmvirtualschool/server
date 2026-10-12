import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateAdmissionApplicationDto } from './create-admission-application.dto';

/** Admin "Pending Enrolled" from Add student: the online admission fields plus admin-only ones. */
export class CreateManualAdmissionDto extends CreateAdmissionApplicationDto {
  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({ example: 'A+' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  bloodGroup?: string;

  @ApiPropertyOptional({ description: 'Class/section to enroll into on approval (with rollNumber).' })
  @IsOptional()
  @IsString()
  sectionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  rollNumber?: string;
}
