import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ContentType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';

export class CreateContentItemDto {
  @ApiProperty({ enum: ContentType })
  @IsEnum(ContentType)
  type!: ContentType;

  @ApiProperty()
  @IsString()
  title!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  orderIndex!: number;

  @ApiPropertyOptional({
    description: 'Required when type=VIDEO_YOUTUBE. Must be a valid YouTube URL.',
  })
  @IsOptional()
  @IsUrl()
  youtubeUrl?: string;

  @ApiPropertyOptional({ description: 'Required when type=DOCUMENT. S3 key.' })
  @IsOptional()
  @IsString()
  documentKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  documentName?: string;

  @ApiPropertyOptional({ description: 'Required when type=TEXT.' })
  @IsOptional()
  @IsString()
  body?: string;

  @ApiPropertyOptional({ description: 'Required when type=LINK.' })
  @IsOptional()
  @IsUrl()
  externalUrl?: string;
}

export class UpdateContentItemDto extends PartialType(CreateContentItemDto) {}
