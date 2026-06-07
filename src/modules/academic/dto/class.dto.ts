import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

export class CreateClassDto {
  @ApiProperty()
  @IsString()
  academicYearId!: string;

  @ApiProperty({ example: 'Grade 10' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 10 })
  @IsInt()
  @Min(0)
  level!: number;
}

export class UpdateClassDto extends PartialType(CreateClassDto) {}
