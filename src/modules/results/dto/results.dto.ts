import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const CATEGORY_SOURCES = ['EXAM', 'QUIZ', 'ASSIGNMENT', 'HOMEWORK', 'MANUAL'] as const;
export type CategorySource = (typeof CATEGORY_SOURCES)[number];
export const REPORT_TEMPLATES = ['STANDARD', 'MODERN', 'DETAILED'] as const;

/** PDF1 13.1 one grade band: letter, percentage range, grade point, remarks. */
export class GradeBandDto {
  @ApiProperty({ example: 'A+' }) @IsString() @MinLength(1) @MaxLength(5) letter!: string;
  @ApiProperty({ example: 90 }) @IsNumber() @Min(0) @Max(100) from!: number;
  @ApiProperty({ example: 100 }) @IsNumber() @Min(0) @Max(100) to!: number;
  @ApiPropertyOptional({ example: 4 }) @IsOptional() @IsNumber() @Min(0) @Max(10) points?: number;
  @ApiPropertyOptional({ example: 'Excellent' }) @IsOptional() @IsString() @MaxLength(60) remarks?: string;
}

export class CreateGradeScaleDto {
  @ApiProperty({ example: 'Standard grading' }) @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @ApiPropertyOptional({ description: 'Academic session (empty = any)' }) @IsOptional() @IsString() academicYearId?: string;
  @ApiProperty({ description: 'Passing criteria: minimum % to pass a subject and overall', example: 33 }) @IsNumber() @Min(0) @Max(100) passPercent!: number;
  @ApiProperty({ type: [GradeBandDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => GradeBandDto)
  bands!: GradeBandDto[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateGradeScaleDto extends PartialType(CreateGradeScaleDto) {}

/** PDF1 13.2 assessment category with its weightage (PDF2 Teacher 11: Quiz, Homework, Assignment, Teacher Assessment, Paper Term, own ones). */
export class ResultCategoryDto {
  @ApiProperty({ example: 'midterm' }) @IsString() @Matches(/^[a-z0-9_]{1,30}$/, { message: 'key: lower-case letters, digits and _' }) key!: string;
  @ApiProperty({ example: 'Mid-Term paper' }) @IsString() @MinLength(1) @MaxLength(60) name!: string;
  @ApiProperty({ enum: CATEGORY_SOURCES }) @IsIn(CATEGORY_SOURCES as unknown as string[]) source!: CategorySource;
  @ApiProperty({ example: 40 }) @IsNumber() @Min(0) @Max(100) weight!: number;
  @ApiPropertyOptional({ description: 'EXAM: the exam session whose papers count' }) @IsOptional() @IsString() examId?: string;
}

export class CreateResultTermDto {
  @ApiProperty({ example: 'First Term Result 2026' }) @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @ApiProperty() @IsString() academicYearId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() gradeScaleId?: string;
  @ApiProperty({ type: [ResultCategoryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(15)
  @ValidateNested({ each: true })
  @Type(() => ResultCategoryDto)
  categories!: ResultCategoryDto[];
  @ApiPropertyOptional({ example: '2026-08-01' }) @IsOptional() @IsDateString() fromDate?: string;
  @ApiPropertyOptional({ example: '2026-12-31' }) @IsOptional() @IsDateString() toDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() includeAttendance?: boolean;
  @ApiPropertyOptional({ description: '% of the overall result that comes from attendance' }) @IsOptional() @IsNumber() @Min(0) @Max(50) attendanceWeight?: number;
}

export class UpdateResultTermDto extends PartialType(OmitType(CreateResultTermDto, ['academicYearId'] as const)) {}

/** Teachers (PDF2 Teacher 11 "add option to add categories"): a category whose marks they enter by hand. */
export class AddCategoryDto {
  @ApiProperty({ example: 'Project work' }) @IsString() @MinLength(2) @MaxLength(60) name!: string;
  @ApiProperty({ example: 10 }) @IsNumber() @Min(0) @Max(100) weight!: number;
}

export class SheetQueryDto {
  @ApiProperty() @IsString() courseId!: string;
}

export class SheetRowDto {
  @ApiProperty({ description: 'StudentProfile id' }) @IsString() studentId!: string;
  @ApiProperty({ description: '{categoryKey: {obtained: number | null, max: number, manual?: boolean}}' }) @IsObject() marks!: Record<string, unknown>;
  @ApiPropertyOptional({ description: 'Grace marks (added to the subject %)' }) @IsOptional() @IsNumber() @Min(0) @Max(100) grace?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) remarks?: string;
}

/** PDF1 13.2 subject-wise marks entry grid. */
export class SaveSheetDto {
  @ApiProperty() @IsString() courseId!: string;
  @ApiProperty({ type: [SheetRowDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SheetRowDto)
  rows!: SheetRowDto[];
}

export class ResultsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() sectionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() classId?: string;
}

export class CoCurricularDto {
  @ApiProperty({ example: 'Sports' }) @IsString() @MinLength(1) @MaxLength(60) activity!: string;
  @ApiProperty({ example: 'A' }) @IsString() @MinLength(1) @MaxLength(30) grade!: string;
}

/** PDF1 13.3 report-card remarks (teacher, principal) and co-curricular grading. */
export class UpdateSummaryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(600) teacherRemarks?: string;
  @ApiPropertyOptional({ description: 'Admin only' }) @IsOptional() @IsString() @MaxLength(600) principalRemarks?: string;
  @ApiPropertyOptional({ type: [CoCurricularDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => CoCurricularDto)
  coCurricular?: CoCurricularDto[];
}

export class ImageRefDto {
  @ApiProperty() @IsString() key!: string;
  @ApiProperty() @IsString() name!: string;
}

export class ReportCardSettingsDto {
  @ApiProperty({ enum: REPORT_TEMPLATES }) @IsIn(REPORT_TEMPLATES as unknown as string[]) template!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) schoolName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) principalName?: string;
  @ApiPropertyOptional({ type: ImageRefDto, description: 'School logo (own image upload); null removes it' }) @IsOptional() @ValidateNested() @Type(() => ImageRefDto) logo?: ImageRefDto | null;
  @ApiPropertyOptional({ type: ImageRefDto, description: "Principal's signature (own image upload); null removes it" }) @IsOptional() @ValidateNested() @Type(() => ImageRefDto) signature?: ImageRefDto | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) footerNote?: string;
}
