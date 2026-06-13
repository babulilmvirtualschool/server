import { ApiPropertyOptional } from '@nestjs/swagger';
import { AdmissionApplicationStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/pagination/pagination.dto';

export class ListAdmissionApplicationsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: AdmissionApplicationStatus })
  @IsOptional()
  @IsEnum(AdmissionApplicationStatus)
  status?: AdmissionApplicationStatus;
}
