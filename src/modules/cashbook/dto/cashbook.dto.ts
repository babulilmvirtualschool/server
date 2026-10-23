import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CashEntryType, PaymentMethod } from '@prisma/client';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CashCategoriesQueryDto {
  @ApiProperty({ enum: CashEntryType })
  @IsEnum(CashEntryType)
  type!: CashEntryType;
}

/** PDF1 6.3 "Add Custom Category" (expenses) and 6.4 income categories. */
export class SaveCashCategoryDto {
  @ApiProperty({ enum: CashEntryType })
  @IsEnum(CashEntryType)
  type!: CashEntryType;

  @ApiProperty({ example: 'Electricity' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;
}

export class RenameCashCategoryDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;
}

/** One expense (6.3 "Add Expense") or one other-income receipt (6.4 "Add Income"). */
export class SaveCashEntryDto {
  @ApiProperty({ enum: CashEntryType })
  @IsEnum(CashEntryType)
  type!: CashEntryType;

  @ApiProperty()
  @IsString()
  categoryId!: string;

  @ApiProperty({ example: '2026-10-23' })
  @IsDateString()
  date!: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiProperty({ example: 'October electricity bill' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  title!: string;

  @ApiPropertyOptional({ description: 'Paid to (expense) / received from (income)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  party?: string;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateCashEntryDto extends PartialType(SaveCashEntryDto) {}

export class CashEntriesQueryDto {
  @ApiProperty({ enum: CashEntryType })
  @IsEnum(CashEntryType)
  type!: CashEntryType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}

/** PDF1 6.5 Profit & loss: Monthly summary | Category | Date range. */
export class ProfitLossQueryDto {
  @ApiProperty({ example: '2026-04-01' })
  @IsDateString()
  from!: string;

  @ApiProperty({ example: '2027-03-31' })
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({ description: 'Only this expense / income category' })
  @IsOptional()
  @IsString()
  categoryId?: string;
}
