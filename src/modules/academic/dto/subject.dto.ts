import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { SubjectCategory, SubjectType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateSubjectDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ enum: SubjectType })
  @IsOptional()
  @IsEnum(SubjectType)
  type?: SubjectType;

  @ApiPropertyOptional({ enum: SubjectCategory, description: 'Core or Elective' })
  @IsOptional()
  @IsEnum(SubjectCategory)
  category?: SubjectCategory;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  totalMarks?: number;

  @ApiPropertyOptional({ example: 33 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  passingMarks?: number;
}

export class UpdateSubjectDto extends PartialType(CreateSubjectDto) {}
