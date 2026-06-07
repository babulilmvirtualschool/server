import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateSalaryStructureDto {
  @ApiProperty()
  @IsString()
  teacherId!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  baseSalary!: number;

  @ApiPropertyOptional({
    description: 'Array of { name, amount } allowances',
  })
  @IsOptional()
  allowances?: { name: string; amount: number }[];

  @ApiPropertyOptional({
    description: 'Array of { name, amount } deductions',
  })
  @IsOptional()
  deductions?: { name: string; amount: number }[];

  @ApiProperty()
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}

export class RecordSalaryPaymentDto {
  @ApiProperty()
  @IsString()
  teacherId!: string;

  @ApiProperty({ example: '2025-09' })
  @IsString()
  period!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  grossAmount!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  netAmount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  breakdown?: Record<string, unknown>;

  @ApiProperty()
  @IsDateString()
  paidAt!: string;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  slipKey?: string;
}
