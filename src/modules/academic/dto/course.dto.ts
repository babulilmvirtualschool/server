import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateCourseDto {
  @ApiProperty()
  @IsString()
  subjectId!: string;

  @ApiProperty()
  @IsString()
  sectionId!: string;

  @ApiProperty()
  @IsString()
  academicYearId!: string;

  @ApiProperty({ description: 'TeacherProfile.id (a teacher adding their own course may leave it out)' })
  @IsOptional()
  @IsString()
  teacherId!: string;

  @ApiPropertyOptional({ example: 5, description: 'Weekly credit hours = periods per week' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(40)
  weeklyHours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  coverImageKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCourseDto extends PartialType(CreateCourseDto) {}
