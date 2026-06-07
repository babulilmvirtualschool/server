import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const MAX_CV_BYTES = 10 * 1024 * 1024; // 10 MB

export class TeacherCvPresignDto {
  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  mimeType!: string;

  @ApiProperty({ maximum: MAX_CV_BYTES })
  @IsInt()
  @Min(1)
  @Max(MAX_CV_BYTES)
  size!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  originalName?: string;
}

export { MAX_CV_BYTES };
