import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateSectionDto {
  @ApiProperty()
  @IsString()
  classId!: string;

  @ApiProperty({ example: 'A' })
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  room?: string;

  @ApiPropertyOptional({ description: 'TeacherProfile.id' })
  @IsOptional()
  @IsString()
  classTeacherId?: string;
}

export class UpdateSectionDto extends PartialType(CreateSectionDto) {}
