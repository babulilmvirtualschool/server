import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AnnouncementAudience } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export class CreateAnnouncementDto {
  @ApiProperty()
  @IsString()
  title!: string;

  @ApiProperty()
  @IsString()
  body!: string;

  @ApiProperty({ enum: AnnouncementAudience })
  @IsEnum(AnnouncementAudience)
  audience!: AnnouncementAudience;

  @ValidateIf((o) => o.audience === 'SECTION')
  @IsString()
  @ApiPropertyOptional()
  sectionId?: string;

  @ValidateIf((o) => o.audience === 'COURSE')
  @IsString()
  @ApiPropertyOptional()
  courseId?: string;

  @ApiPropertyOptional({
    description: 'Array of { key, name, size, mime }',
  })
  @IsOptional()
  @IsArray()
  attachments?: { key: string; name: string; size?: number; mime?: string }[];
}

export class UpdateAnnouncementDto extends PartialType(CreateAnnouncementDto) {}
