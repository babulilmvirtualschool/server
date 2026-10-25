import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** PDF2 Teacher 1 "End-of-Lesson Assessment": a 2-minute quick quiz / poll after the class. */
export class CreateLivePollDto {
  @ApiProperty({ example: 'What is 7 × 8?' })
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  question!: string;

  @ApiProperty({ type: [String], example: ['54', '56', '64'] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(150, { each: true })
  options!: string[];

  @ApiPropertyOptional({ description: 'Index of the correct option (leave out for an opinion poll)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  correctOption?: number;

  @ApiPropertyOptional({ default: 120, minimum: 30, maximum: 600 })
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(600)
  durationSeconds?: number;

  @ApiPropertyOptional({ default: true, description: 'Start it straight away' })
  @IsOptional()
  @IsBoolean()
  start?: boolean;
}

export class AnswerLivePollDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(5)
  option!: number;
}
