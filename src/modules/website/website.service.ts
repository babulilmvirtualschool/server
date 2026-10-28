import { BadRequestException, Injectable } from '@nestjs/common';
import { MediaPurpose, Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { ownUploads } from '../../common/utils/own-uploads';
import { PrismaService } from '../../prisma/prisma.service';
import { R2Service } from '../media/r2.service';
import { ImageRefDto, WebsiteSettingsDto } from './dto/website.dto';

type Slide = { imageKey: string; imageName?: string; tagline?: string };

/** PDF2 Admin 5 website management: popup image, CTA number, sliding images, sliding text (one row for the shared website). */
@Injectable()
export class WebsiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
  ) {}

  private async row() {
    return this.prisma.websiteSettings.findUnique({ where: { id: 'main' } });
  }

  async adminView() {
    const s = await this.row();
    const slides = ((s?.slides ?? []) as Slide[]) ?? [];
    return {
      saved: !!s,
      popupEnabled: s?.popupEnabled ?? true,
      popupImage: s?.popupImageKey ? { key: s.popupImageKey, name: 'Popup image', url: await this.r2.presignGet(s.popupImageKey) } : null,
      popupLink: s?.popupLink ?? '',
      ctaNumber: s?.ctaNumber ?? '',
      slides: await Promise.all(slides.map(async (sl) => ({ image: { key: sl.imageKey, name: sl.imageName ?? 'Slide', url: await this.r2.presignGet(sl.imageKey) }, tagline: sl.tagline ?? '' }))),
      slidingText: ((s?.slidingText ?? []) as string[]) ?? [],
      updatedAt: s?.updatedAt ?? null,
    };
  }

  async save(dto: WebsiteSettingsDto, user: AuthUser) {
    const current = await this.row();
    const known = new Set([current?.popupImageKey, ...((current?.slides ?? []) as Slide[]).map((s) => s.imageKey)].filter(Boolean) as string[]);
    const fresh = [dto.popupImage, ...dto.slides.map((s) => s.image)].filter((r): r is ImageRefDto => !!r && !known.has(r.key));
    const unique = [...new Map(fresh.map((f) => [f.key, f])).values()];
    if (unique.length) {
      const files = await ownUploads(this.prisma, user, unique, MediaPurpose.OTHER);
      if (files.some((f) => !/^image\/(png|jpeg|jpg|webp|gif)$/.test(f.mime))) throw new BadRequestException('Website images must be PNG, JPG, WebP or GIF.');
    }
    const data = {
      popupEnabled: dto.popupEnabled,
      popupImageKey: dto.popupImage?.key ?? null,
      popupLink: dto.popupLink?.trim() || null,
      ctaNumber: dto.ctaNumber?.trim() || null,
      slides: dto.slides.map((s) => ({ imageKey: s.image.key, imageName: s.image.name, tagline: s.tagline?.trim() || '' })) as unknown as Prisma.InputJsonValue,
      slidingText: dto.slidingText.map((t) => t.trim()).filter(Boolean),
    };
    await this.prisma.websiteSettings.upsert({ where: { id: 'main' }, create: { id: 'main', ...data }, update: data });
    return this.adminView();
  }

  /** What the public website shows (images as short-lived links; empty parts keep the built-in content). */
  async publicView() {
    const s = await this.row();
    if (!s) return { popup: { show: true, imageUrl: null, link: null }, ctaNumber: null, slides: [], slidingText: [] };
    const slides = (s.slides ?? []) as Slide[];
    return {
      /** Off = no popup; on without an image = the website's built-in admissions banner; on with an image = that image. */
      popup: { show: s.popupEnabled, imageUrl: s.popupEnabled && s.popupImageKey ? await this.r2.presignGet(s.popupImageKey) : null, link: s.popupLink },
      ctaNumber: s.ctaNumber,
      slides: await Promise.all(slides.map(async (sl) => ({ imageUrl: await this.r2.presignGet(sl.imageKey), tagline: sl.tagline ?? '' }))),
      slidingText: (s.slidingText ?? []) as string[],
    };
  }
}
