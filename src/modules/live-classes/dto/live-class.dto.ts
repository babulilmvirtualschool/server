import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { LiveClassPlatform, LiveClassStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';

export class CreateLiveClassDto {
  @ApiProperty()
  @IsString()
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty()
  @IsUrl()
  meetingLink!: string;

  @ApiPropertyOptional({ enum: LiveClassPlatform, description: 'Google Meet or Zoom (worked out from the link when left out)' })
  @IsOptional()
  @IsEnum(LiveClassPlatform)
  platform?: LiveClassPlatform;

  @ApiProperty()
  @IsDateString()
  scheduledStart!: string;

  @ApiProperty()
  @IsDateString()
  scheduledEnd!: string;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  joinBufferMinutes?: number;
}

export class UpdateLiveClassDto extends PartialType(CreateLiveClassDto) {
  @ApiPropertyOptional({ enum: LiveClassStatus })
  @IsOptional()
  @IsEnum(LiveClassStatus)
  status?: LiveClassStatus;
}
