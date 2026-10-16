import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/** Files the website forms can attach (admission documents + student photo, faculty photo). */
export const ADMISSION_DOCUMENT_KINDS = [
  'STUDENT_PHOTO',
  'B_FORM',
  'LEAVING_CERTIFICATE',
  'FATHER_CNIC_FRONT',
  'FATHER_CNIC_BACK',
  'MOTHER_CNIC_FRONT',
  'MOTHER_CNIC_BACK',
] as const;
export const APPLICATION_UPLOAD_KINDS = [...ADMISSION_DOCUMENT_KINDS, 'TEACHER_PHOTO'] as const;
export type ApplicationUploadKind = (typeof APPLICATION_UPLOAD_KINDS)[number];

export const PHOTO_KINDS: readonly ApplicationUploadKind[] = ['STUDENT_PHOTO', 'TEACHER_PHOTO'];
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const APPLICATION_UPLOAD_PREFIX = 'applications/uploads/';

/** Storage key for an upload of this kind, e.g. `applications/uploads/b-form/...`. */
export const uploadKeyPrefix = (kind: ApplicationUploadKind) =>
  `${APPLICATION_UPLOAD_PREFIX}${kind.toLowerCase().replace(/_/g, '-')}/`;

export class ApplicationUploadPresignDto {
  @ApiProperty({ enum: APPLICATION_UPLOAD_KINDS })
  @IsIn(APPLICATION_UPLOAD_KINDS as unknown as string[])
  kind!: ApplicationUploadKind;

  @ApiProperty({ example: 'image/jpeg', description: 'Photos: jpeg/png/webp. Documents: jpeg/png/webp/pdf.' })
  @IsString()
  mimeType!: string;

  @ApiProperty({ description: 'Photos ≤ 5 MB, documents ≤ 10 MB.' })
  @IsInt()
  @Min(1)
  @Max(MAX_DOCUMENT_BYTES)
  size!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  originalName?: string;
}

/** One uploaded admission document on the website form. */
export class AdmissionDocumentDto {
  @ApiProperty({ enum: ADMISSION_DOCUMENT_KINDS })
  @IsIn(ADMISSION_DOCUMENT_KINDS as unknown as string[])
  kind!: (typeof ADMISSION_DOCUMENT_KINDS)[number];

  @ApiProperty({ description: 'Key from POST applications/uploads/presign.' })
  @IsString()
  @Matches(/^applications\/uploads\/[a-z-]+\/[\w.-]+$/)
  key!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}
