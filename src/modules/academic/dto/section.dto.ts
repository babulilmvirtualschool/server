import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateSectionDto {
  @ApiProperty()
  @IsString()
  classId!: string;

  @ApiProperty({ example: 'A' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: 'Room 12' })
  @IsOptional()
  @IsString()
  room?: string;

  @ApiPropertyOptional({ example: 35, description: 'Maximum students' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  capacity?: number;

  @ApiPropertyOptional({ description: 'TeacherProfile.id' })
  @IsOptional()
  @IsString()
  classTeacherId?: string;
}

export class UpdateSectionDto extends PartialType(CreateSectionDto) {}
