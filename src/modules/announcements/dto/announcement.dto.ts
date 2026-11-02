import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AnnouncementAudience } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateAnnouncementDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Enter a title' })
  @MaxLength(200)
  title!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Enter the message' })
  @MaxLength(5000)
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
