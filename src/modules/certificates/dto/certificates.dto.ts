import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CertificateType } from '@prisma/client';
import { IsDateString, IsEnum, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class ListCertificatesDto {
  @ApiPropertyOptional({ enum: CertificateType })
  @IsOptional()
  @IsEnum(CertificateType)
  type?: CertificateType;

  @ApiPropertyOptional({ description: 'Holder User id' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class PrefillCertificateDto {
  @ApiProperty({ enum: CertificateType })
  @IsEnum(CertificateType)
  type!: CertificateType;

  @ApiProperty({ description: 'Holder User id (student, teacher or non-teaching staff)' })
  @IsString()
  userId!: string;
}

export class CreateCertificateDto extends PrefillCertificateDto {
  @ApiProperty({ example: '2026-10-29' })
  @IsDateString()
  issueDate!: string;

  @ApiProperty({ description: 'Fields printed on the certificate, {key: text}', type: Object })
  @IsObject()
  details!: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

export class UpdateCertificateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  details?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

export class IdCardsQueryDto {
  @ApiProperty({ enum: ['STUDENT', 'STAFF'] })
  @IsIn(['STUDENT', 'STAFF'])
  kind!: 'STUDENT' | 'STAFF';

  @ApiPropertyOptional({ description: 'Students: one class (section)' })
  @IsOptional()
  @IsString()
  sectionId?: string;

  @ApiPropertyOptional({ description: 'Comma-separated User ids' })
  @IsOptional()
  @IsString()
  userIds?: string;
}
