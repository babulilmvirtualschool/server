import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../../common/pagination/pagination.dto';

export const USER_SORTS = ['newest', 'oldest', 'name_asc', 'name_desc'] as const;

export class ListUsersDto extends PaginationDto {
  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBooleanString()
  isActive?: string;

  @ApiPropertyOptional({ enum: USER_SORTS, default: 'newest' })
  @IsOptional()
  @IsIn(USER_SORTS)
  sort?: (typeof USER_SORTS)[number];

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({ description: 'Minimum age in years (from date of birth)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minAge?: number;

  @ApiPropertyOptional({ description: 'Maximum age in years (from date of birth)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  maxAge?: number;

  @ApiPropertyOptional({ description: 'true = has a photo, false = no photo' })
  @IsOptional()
  @IsBooleanString()
  hasPhoto?: string;
}

/** Same filters as the list, without pagination (student exports). */
export class ExportStudentsDto extends ListUsersDto {}
