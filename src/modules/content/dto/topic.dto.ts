import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ContentProgress } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateTopicDto {
  @ApiProperty()
  @IsString()
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  orderIndex!: number;
}

export class UpdateTopicDto extends PartialType(CreateTopicDto) {
  @ApiPropertyOptional({ enum: ContentProgress, description: "Teacher's progress button: Pending / In progress / Complete" })
  @IsOptional()
  @IsEnum(ContentProgress)
  progress?: ContentProgress;
}
