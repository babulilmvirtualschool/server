import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FeeFrequency, PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class FeeComponentInputDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  amount!: number;

  @ApiProperty({ enum: FeeFrequency })
  @IsEnum(FeeFrequency)
  frequency!: FeeFrequency;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;
}

export class CreateFeeStructureDto {
  @ApiProperty()
  @IsString()
  classId!: string;

  @ApiProperty()
  @IsString()
  academicYearId!: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty({ type: [FeeComponentInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeeComponentInputDto)
  components!: FeeComponentInputDto[];
}

export class GenerateInvoicesDto {
  @ApiProperty()
  @IsString()
  feeStructureId!: string;

  @ApiProperty({ example: '2025-09' })
  @IsString()
  period!: string;

  @ApiProperty({
    description: 'Frequencies to include from the fee structure in this invoice.',
    enum: FeeFrequency,
    isArray: true,
  })
  @IsArray()
  @IsEnum(FeeFrequency, { each: true })
  includeFrequencies!: FeeFrequency[];

  @ApiProperty()
  @IsDateString()
  dueDate!: string;
}

export class RecordFeePaymentDto {
  @ApiProperty()
  @IsNumber()
  @Min(0)
  amount!: number;

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
  receiptKey?: string;
}
