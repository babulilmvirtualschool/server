import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** PDF1 4.2 Fee reports: Daily | Monthly | Outstanding | By type, filtered by one student or that student's family. */
export class FeeReportQueryDto {
  @ApiPropertyOptional({ enum: ['DAILY', 'MONTHLY', 'OUTSTANDING', 'BY_TYPE'] })
  @IsIn(['DAILY', 'MONTHLY', 'OUTSTANDING', 'BY_TYPE'])
  kind!: 'DAILY' | 'MONTHLY' | 'OUTSTANDING' | 'BY_TYPE';

  @ApiPropertyOptional({ example: '2026-10-23', description: 'DAILY: the day (default today)' })
  @IsOptional()
  @Matches(DATE_RE, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  @ApiPropertyOptional({ example: '2026-10', description: 'MONTHLY / BY_TYPE: the month (default this month)' })
  @IsOptional()
  @Matches(PERIOD_RE, { message: 'month must be YYYY-MM' })
  month?: string;

  @ApiPropertyOptional({ description: 'Section id' })
  @IsOptional()
  @IsString()
  sectionId?: string;

  @ApiPropertyOptional({ description: 'StudentProfile id — only this student (or, with family=true, the brothers and sisters too)' })
  @IsOptional()
  @IsString()
  studentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['true', 'false'])
  family?: 'true' | 'false';
}

/** PDF1 4.3 Fee register: Academic year | Session start month | Class | Status. */
export class FeeRegisterQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  academicYearId?: string;

  @ApiPropertyOptional({ description: '1–12; default the fee settings session start month' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  sessionStartMonth?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sectionId?: string;

  @ApiPropertyOptional({ enum: ['PAID', 'UNPAID', 'PARTIAL', 'DISCHARGED', 'REMITTED'] })
  @IsOptional()
  @IsIn(['PAID', 'UNPAID', 'PARTIAL', 'DISCHARGED', 'REMITTED'])
  status?: 'PAID' | 'UNPAID' | 'PARTIAL' | 'DISCHARGED' | 'REMITTED';
}

/** PDF1 5.1 Fee record / ledger. */
export class FeeLedgerQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  academicYearId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sectionId?: string;

  @ApiPropertyOptional({ description: 'Name, roll no. or mobile no.' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['ROLL', 'ADMISSION', 'NAME'] })
  @IsOptional()
  @IsIn(['ROLL', 'ADMISSION', 'NAME'])
  sort?: 'ROLL' | 'ADMISSION' | 'NAME';
}
