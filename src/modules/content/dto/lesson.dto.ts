import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ContentProgress } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateLessonDto {
  @ApiProperty()
  @IsString()
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  orderIndex!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class UpdateLessonDto extends PartialType(CreateLessonDto) {
  @ApiPropertyOptional({ enum: ContentProgress, description: "Teacher's progress button: Pending / In progress / Complete" })
  @IsOptional()
  @IsEnum(ContentProgress)
  progress?: ContentProgress;
}
