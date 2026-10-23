import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export class SalaryItemDto {
  @ApiProperty({ example: 'House rent' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  amount!: number;
}

/** PDF1 6.1 "+ Assign Salary" to a teacher / staff member (a new assignment replaces the previous one from its date). */
export class CreateSalaryStructureDto {
  @ApiProperty({ description: 'TeacherProfile id (teachers and non-teaching staff)' })
  @IsString()
  teacherId!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  baseSalary!: number;

  @ApiPropertyOptional({ type: [SalaryItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SalaryItemDto)
  allowances?: SalaryItemDto[];

  @ApiPropertyOptional({ type: [SalaryItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SalaryItemDto)
  deductions?: SalaryItemDto[];

  @ApiProperty({ example: '2026-10-01' })
  @IsDateString()
  effectiveFrom!: string;
}

/** PDF1 6.1 "Auto Salary Record — [Select Month] [Generate Salary]". */
export class GenerateSalariesDto {
  @ApiProperty({ example: '2026-10' })
  @Matches(PERIOD_RE, { message: 'period must be YYYY-MM' })
  period!: string;

  @ApiPropertyOptional({ description: 'Only these TeacherProfile ids (default: everyone with an assigned salary)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  teacherIds?: string[];
}

export class SalariesQueryDto {
  @ApiPropertyOptional({ example: '2026-10' })
  @IsOptional()
  @Matches(PERIOD_RE, { message: 'period must be YYYY-MM' })
  period?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  teacherId?: string;

  @ApiPropertyOptional({ enum: ['PAID', 'UNPAID', 'PARTIAL'] })
  @IsOptional()
  @IsIn(['PAID', 'UNPAID', 'PARTIAL'])
  status?: 'PAID' | 'UNPAID' | 'PARTIAL';
}

export class AnnualSalariesQueryDto {
  @ApiProperty({ example: '2026' })
  @Matches(/^\d{4}$/, { message: 'year must be YYYY' })
  year!: string;
}

export class PaySalaryDto {
  @ApiProperty()
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiProperty({ example: '2026-10-31' })
  @IsDateString()
  paidAt!: string;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}

/** PDF1 6.1 "Staff Advance Record". */
export class CreateAdvanceDto {
  @ApiProperty()
  @IsString()
  teacherId!: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiProperty({ example: '2026-10-05' })
  @IsDateString()
  givenOn!: string;

  @ApiPropertyOptional({ description: 'Recovered from each salary; 0 = all from the next salary' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyDeduction?: number;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class AdvancesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  teacherId?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: ['OPEN', 'RECOVERED'] })
  @IsOptional()
  @IsIn(['OPEN', 'RECOVERED'])
  status?: 'OPEN' | 'RECOVERED';
}

/** A fine deducted from one month's salary (PDF2 Teacher 9. Pay "Fine"). */
export class CreateFineDto {
  @ApiProperty()
  @IsString()
  teacherId!: string;

  @ApiProperty({ example: '2026-10' })
  @Matches(PERIOD_RE, { message: 'period must be YYYY-MM' })
  period!: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reason!: string;
}

export class FinesQueryDto {
  @ApiPropertyOptional({ example: '2026-10' })
  @IsOptional()
  @Matches(PERIOD_RE, { message: 'period must be YYYY-MM' })
  period?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  teacherId?: string;
}
