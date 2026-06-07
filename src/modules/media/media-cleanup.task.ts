import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { R2Service } from './r2.service';

@Injectable()
export class MediaCleanupTask {
  private readonly logger = new Logger(MediaCleanupTask.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
  ) {}

  /** Deletes unfinalized R2 uploads older than 24h. Runs daily at 03:00. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupOrphans() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const orphans = await this.prisma.mediaAsset.findMany({
      where: { finalized: false, createdAt: { lt: cutoff } },
    });
    for (const o of orphans) {
      try {
        await this.r2.delete(o.key);
      } catch (err) {
        this.logger.warn(`R2 delete failed for ${o.key}: ${(err as Error).message}`);
      }
      await this.prisma.mediaAsset.delete({ where: { id: o.id } });
    }
    if (orphans.length) {
      this.logger.log(`Cleaned up ${orphans.length} orphan uploads`);
    }
  }
}
