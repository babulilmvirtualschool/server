import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DiscountValueType, FeeFrequency, PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../../common/pagination/pagination.dto';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Fee types / discounts use Monthly, Yearly (ANNUAL) and One-time. */
export const FEE_FREQS = [FeeFrequency.MONTHLY, FeeFrequency.ANNUAL, FeeFrequency.ONE_TIME] as const;

/** PDF1 5.2 Fee settings. */
export class SaveFeeSettingsDto {
  @ApiProperty({ example: 'Rs.' })
  @IsString()
  @MinLength(1)
  @MaxLength(8)
  currencySymbol!: string;

  @ApiProperty({ example: 4, description: 'Session start month 1–12' })
  @IsInt()
  @Min(1)
  @Max(12)
  sessionStartMonth!: number;

  @ApiProperty({ example: 10, description: 'Due day of the month 1–28' })
  @IsInt()
  @Min(1)
  @Max(28)
  dueDay!: number;

  @ApiProperty()
  @IsBoolean()
  lateFeeEnabled!: boolean;

  @ApiProperty({ example: 200 })
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  lateFeeAmount!: number;

  @ApiProperty()
  @IsBoolean()
  printInstructions!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  instructions?: string;

  @ApiProperty()
  @IsBoolean()
  hideDiscount!: boolean;

  @ApiProperty()
  @IsBoolean()
  blockDefaulters!: boolean;

  @ApiProperty({ example: 30 })
  @IsInt()
  @Min(0)
  @Max(365)
  defaulterGraceDays!: number;

  @ApiProperty({ example: 3, description: 'Copies per voucher (1–3: Bank / School / Student)' })
  @IsInt()
  @Min(1)
  @Max(3)
  voucherCopies!: number;

  @ApiProperty()
  @IsBoolean()
  siblingPolicyEnabled!: boolean;

  @ApiProperty()
  @IsBoolean()
  siblingMonthlyOnly!: boolean;
}

/** PDF1 3.1 fee type. */
export class SaveFeeTypeDto {
  @ApiProperty()
  @IsString()
  classId!: string;

  @ApiProperty({ example: 'Monthly Tuition Fee' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ enum: FEE_FREQS })
  @IsIn(FEE_FREQS as unknown as string[], { message: 'frequency must be MONTHLY, ANNUAL or ONE_TIME' })
  frequency!: FeeFrequency;

  @ApiProperty({ example: 6000 })
  @IsNumber()
  @Min(0)
  @Max(10_000_000)
  amount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class FeeTypesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  classId?: string;

  @ApiPropertyOptional({ description: 'Default: the current year' })
  @IsOptional()
  @IsString()
  academicYearId?: string;
}

/** PDF1 3.2 discount for one or more students on a fee type. */
export class CreateFeeDiscountDto {
  @ApiProperty({ type: [String], description: 'StudentProfile ids' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  studentIds!: string[];

  @ApiProperty()
  @IsString()
  feeTypeId!: string;

  @ApiProperty({ enum: FEE_FREQS, description: 'Monthly = every challan, Yearly = once a session, One-time = once' })
  @IsIn(FEE_FREQS as unknown as string[], { message: 'frequency must be MONTHLY, ANNUAL or ONE_TIME' })
  frequency!: FeeFrequency;

  @ApiProperty({ enum: DiscountValueType })
  @IsEnum(DiscountValueType)
  valueType!: DiscountValueType;

  @ApiProperty({ example: 1000 })
  @IsNumber()
  @Min(0.01)
  @Max(10_000_000)
  value!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class UpdateFeeDiscountDto {
  @ApiPropertyOptional({ enum: FEE_FREQS })
  @IsOptional()
  @IsIn(FEE_FREQS as unknown as string[])
  frequency?: FeeFrequency;

  @ApiPropertyOptional({ enum: DiscountValueType })
  @IsOptional()
  @IsEnum(DiscountValueType)
  valueType?: DiscountValueType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(10_000_000)
  value?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class FeeDiscountsQueryDto {
  @ApiPropertyOptional({ description: 'Student name / admission no.' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  classId?: string;
}

export class SiblingRuleDto {
  @ApiProperty({ example: 2, description: '2 = second child, 3 = third child, …' })
  @IsInt()
  @Min(2)
  @Max(10)
  childNumber!: number;

  @ApiProperty({ enum: DiscountValueType })
  @IsEnum(DiscountValueType)
  valueType!: DiscountValueType;

  @ApiProperty({ example: 10 })
  @IsNumber()
  @Min(0.01)
  @Max(10_000_000)
  value!: number;
}

export class SaveSiblingRulesDto {
  @ApiProperty({ type: [SiblingRuleDto] })
  @IsArray()
  @ArrayMaxSize(9)
  @ValidateNested({ each: true })
  @Type(() => SiblingRuleDto)
  rules!: SiblingRuleDto[];
}

export class FamiliesQueryDto {
  @ApiPropertyOptional({ description: 'Father / child name, phone, admission no.' })
  @IsOptional()
  @IsString()
  search?: string;
}

/** Fee calculation for one student and month (PDF1 3.3 summary table). */
export class FeePreviewQueryDto {
  @ApiProperty({ description: 'StudentProfile id' })
  @IsString()
  studentId!: string;

  @ApiProperty({ example: '2026-11' })
  @Matches(PERIOD_RE, { message: 'period must be YYYY-MM' })
  period!: string;

  @ApiPropertyOptional({ description: 'Comma-separated fee type ids (default: monthly + yearly in the session start month)' })
  @IsOptional()
  @IsString()
  feeTypeIds?: string;
}

/** Generate challans: one student, a class, or all admitted students. */
export class GenerateChallansDto {
  @ApiProperty({ example: '2026-11' })
  @Matches(PERIOD_RE, { message: 'period must be YYYY-MM' })
  period!: string;

  @ApiPropertyOptional({ enum: ['STUDENT', 'CLASS', 'ALL'] })
  @IsIn(['STUDENT', 'CLASS', 'ALL'])
  scope!: 'STUDENT' | 'CLASS' | 'ALL';

  @ApiPropertyOptional({ description: 'StudentProfile id (scope STUDENT)' })
  @IsOptional()
  @IsString()
  studentId?: string;

  @ApiPropertyOptional({ description: 'Section id (scope CLASS)' })
  @IsOptional()
  @IsString()
  sectionId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Fee type ids to include; default monthly (+ yearly in the session start month)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  feeTypeIds?: string[];

  @ApiPropertyOptional({ example: '2026-11-10', description: 'Default: the due day of the month' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

/** One voucher for all brothers/sisters of a student. */
export class FamilyChallanDto {
  @ApiProperty({ example: '2026-11' })
  @Matches(PERIOD_RE, { message: 'period must be YYYY-MM' })
  period!: string;

  @ApiProperty({ description: 'StudentProfile id of any child of the family' })
  @IsString()
  studentId!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  feeTypeIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

/** PDF1 4 / 4.1 challan list filters. */
export class ChallansQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Section id' })
  @IsOptional()
  @IsString()
  sectionId?: string;

  @ApiPropertyOptional({ enum: ['PAID', 'UNPAID', 'PARTIAL'] })
  @IsOptional()
  @IsIn(['PAID', 'UNPAID', 'PARTIAL'])
  status?: 'PAID' | 'UNPAID' | 'PARTIAL';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  feeTypeId?: string;

  @ApiPropertyOptional({ example: '2026-11' })
  @IsOptional()
  @Matches(PERIOD_RE, { message: 'period must be YYYY-MM' })
  period?: string;

  @ApiPropertyOptional({ description: 'Only challans with a reminder on or before today' })
  @IsOptional()
  @IsIn(['true', 'false'])
  remindersDue?: 'true' | 'false';
}

export class MissingVouchersQueryDto {
  @ApiProperty({ example: '2026-11' })
  @Matches(PERIOD_RE, { message: 'period must be YYYY-MM' })
  period!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sectionId?: string;
}

export class SetReminderDto {
  @ApiPropertyOptional({ example: '2026-11-15', description: 'null clears it' })
  @IsOptional()
  @IsDateString()
  reminderDate?: string | null;
}

/** Collect a payment: paid towards this student's open challans, oldest first. */
export class CollectFeeDto {
  @ApiProperty({ example: 6000 })
  @IsNumber()
  @Min(1)
  @Max(100_000_000)
  amount!: number;

  @ApiProperty({ example: '2026-11-05' })
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
