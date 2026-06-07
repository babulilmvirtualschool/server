import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MediaPurpose } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class PresignUploadDto {
  @ApiProperty({ enum: MediaPurpose })
  @IsEnum(MediaPurpose)
  purpose!: MediaPurpose;

  @ApiProperty()
  @IsString()
  mimeType!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(500 * 1024 * 1024) // 500 MB
  size!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  originalName?: string;
}

export class FinalizeUploadDto {
  @ApiProperty()
  @IsString()
  key!: string;
}

export class PresignDownloadDto {
  @ApiProperty()
  @IsString()
  key!: string;
}
