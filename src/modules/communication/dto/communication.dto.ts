import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ComplaintKind, ComplaintStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class SendChatDto {
  @ApiProperty({ description: 'User id of the teacher / student' })
  @IsString()
  recipientId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}

export class ChatPairQueryDto {
  @ApiProperty({ description: 'User id' })
  @IsString()
  a!: string;

  @ApiProperty({ description: 'User id' })
  @IsString()
  b!: string;
}

export class CreateComplaintDto {
  @ApiPropertyOptional({ enum: ComplaintKind, default: ComplaintKind.COMPLAINT })
  @IsOptional()
  @IsEnum(ComplaintKind)
  kind?: ComplaintKind;

  @ApiPropertyOptional({ description: 'StudentProfile id — the child (parents); students always file for themselves' })
  @IsOptional()
  @IsString()
  studentId?: string;

  @ApiPropertyOptional({ description: 'TeacherProfile id — optional, the teacher it is about' })
  @IsOptional()
  @IsString()
  teacherId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  body!: string;
}

export class ListComplaintsDto {
  @ApiPropertyOptional({ enum: ComplaintStatus })
  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;

  @ApiPropertyOptional({ enum: ComplaintKind })
  @IsOptional()
  @IsEnum(ComplaintKind)
  kind?: ComplaintKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class UpdateComplaintDto {
  @ApiPropertyOptional({ enum: ComplaintStatus })
  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;

  @ApiPropertyOptional({ description: 'Reply shown to the parent / student' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  reply?: string;
}

export class RateTeacherDto {
  @ApiProperty({ description: 'TeacherProfile id' })
  @IsString()
  teacherId!: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
