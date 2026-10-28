import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';

export class ImageRefDto {
  @ApiProperty() @IsString() key!: string;
  @ApiProperty() @IsString() @MaxLength(255) name!: string;
}

class SlideDto {
  @ApiProperty({ type: ImageRefDto })
  @ValidateNested()
  @Type(() => ImageRefDto)
  image!: ImageRefDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  tagline?: string;
}

export class WebsiteSettingsDto {
  @ApiProperty() @IsBoolean() popupEnabled!: boolean;

  @ApiPropertyOptional({ type: ImageRefDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImageRefDto)
  popupImage?: ImageRefDto | null;

  @ApiPropertyOptional({ description: 'Where the popup goes when clicked, e.g. /apply' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Matches(/^(\/[^\s]*|https?:\/\/[^\s]+)?$/, { message: 'Use a link that starts with / or https://' })
  popupLink?: string;

  @ApiPropertyOptional({ example: '+92 345 6621055', description: 'Call / WhatsApp button number' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^[+0-9 ()-]*$/, { message: 'Use digits, spaces, + or -' })
  ctaNumber?: string;

  @ApiProperty({ type: [SlideDto] })
  @IsArray()
  @ArrayMaxSize(15)
  @ValidateNested({ each: true })
  @Type(() => SlideDto)
  slides!: SlideDto[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  slidingText!: string[];
}
