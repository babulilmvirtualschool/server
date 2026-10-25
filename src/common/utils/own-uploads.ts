import { BadRequestException } from '@nestjs/common';
import { MediaPurpose } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../decorators/current-user.decorator';

export type UploadRef = { key: string; name: string };
export type StoredFile = { key: string; name: string; size: number; mime: string };

/**
 * Files attached to a submission / assignment must be the caller's own finished uploads of the given purpose.
 * Name, size and type are taken from the upload record, not from the request.
 */
export async function ownUploads(prisma: PrismaService, user: AuthUser, files: UploadRef[], purpose: MediaPurpose): Promise<StoredFile[]> {
  const keys = files.map((a) => a.key);
  if (new Set(keys).size !== keys.length) {
    throw new BadRequestException('The same file is attached twice');
  }
  const assets = await prisma.mediaAsset.findMany({ where: { key: { in: keys } } });
  const valid = (key: string) => {
    const m = assets.find((x) => x.key === key);
    return !!m && m.uploaderId === user.id && m.finalized && m.purpose === purpose;
  };
  if (!keys.every(valid)) {
    throw new BadRequestException('One or more files were not uploaded by you for this item');
  }
  return files.map((a) => {
    const m = assets.find((x) => x.key === a.key)!;
    return { key: a.key, name: m.originalName ?? a.name, size: m.size, mime: m.mimeType };
  });
}
