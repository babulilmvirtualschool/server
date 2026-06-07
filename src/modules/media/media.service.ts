import { Injectable, NotFoundException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { MediaPurpose } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { R2Service } from './r2.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  FinalizeUploadDto,
  PresignUploadDto,
} from './dto/media.dto';

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
  ) {}

  private prefixFor(purpose: MediaPurpose): string {
    const map: Record<MediaPurpose, string> = {
      AVATAR: 'avatars',
      COURSE_COVER: 'course-covers',
      CONTENT_DOCUMENT: 'content',
      SYLLABUS: 'syllabi',
      ASSIGNMENT_ATTACHMENT: 'assignments',
      ASSIGNMENT_SUBMISSION: 'submissions',
      FEE_RECEIPT: 'receipts',
      SALARY_SLIP: 'salary-slips',
      ANNOUNCEMENT_ATTACHMENT: 'announcements',
      QUESTION_IMAGE: 'questions',
      OTHER: 'misc',
    };
    return map[purpose] ?? 'misc';
  }

  private sanitizeExt(name?: string) {
    if (!name) return '';
    const m = /\.[A-Za-z0-9]{1,8}$/.exec(name);
    return m ? m[0].toLowerCase() : '';
  }

  async presignUpload(user: AuthUser, dto: PresignUploadDto) {
    const ext = this.sanitizeExt(dto.originalName);
    const key = `tmp/${this.prefixFor(dto.purpose)}/${user.id}/${Date.now()}-${nanoid(10)}${ext}`;
    const uploadUrl = await this.r2.presignPut({
      key,
      contentType: dto.mimeType,
    });
    await this.prisma.mediaAsset.create({
      data: {
        key,
        bucket: this.r2.bucket,
        mimeType: dto.mimeType,
        size: dto.size,
        purpose: dto.purpose,
        uploaderId: user.id,
        originalName: dto.originalName,
        finalized: false,
      },
    });
    return {
      key,
      uploadUrl,
      expiresIn: this.r2.presignExpiresSeconds,
    };
  }

  async finalize(user: AuthUser, dto: FinalizeUploadDto) {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { key: dto.key },
    });
    if (!asset) throw new NotFoundException('Unknown upload key');
    if (asset.uploaderId !== user.id) {
      // Admins can finalize anything; others can only finalize their own.
      if (user.role !== 'ADMIN') throw new NotFoundException();
    }
    return this.prisma.mediaAsset.update({
      where: { key: dto.key },
      data: { finalized: true },
    });
  }

  async presignDownload(key: string) {
    const url = await this.r2.presignGet(key);
    return {
      key,
      url,
      expiresIn: this.r2.presignExpiresSeconds,
    };
  }
}
