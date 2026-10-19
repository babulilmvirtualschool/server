import { ApiPropertyOptional } from '@nestjs/swagger';
import { StaffType } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/pagination/pagination.dto';

export class ListTeacherApplicationsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: StaffType, description: 'Teaching or Non-teaching applications' })
  @IsOptional()
  @IsEnum(StaffType)
  staffType?: StaffType;
}
