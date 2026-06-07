import { Injectable } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfigService } from '../../config/app-config.service';

function ttlToMs(ttl: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)$/i.exec(ttl.trim());
  if (!m) return Number(ttl);
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult =
    unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return n * mult;
}

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly cfg: AppConfigService,
  ) {}

  private hash(raw: string) {
    return createHash('sha256').update(raw).digest('hex');
  }

  async issueAccessToken(userId: string, role: string): Promise<string> {
    const options = {
      secret: this.cfg.jwtAccessSecret,
      expiresIn: this.cfg.jwtAccessTtl,
    } as JwtSignOptions;
    return this.jwt.signAsync(
      { sub: userId, role, type: 'access' },
      options,
    );
  }

  async issueRefreshToken(
    userId: string,
    meta?: { userAgent?: string; ipAddress?: string },
  ): Promise<string> {
    const raw = randomBytes(48).toString('hex');
    const tokenHash = this.hash(raw);
    const expiresAt = new Date(Date.now() + ttlToMs(this.cfg.jwtRefreshTtl));
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        userAgent: meta?.userAgent,
        ipAddress: meta?.ipAddress,
      },
    });
    return raw;
  }

  async rotateRefreshToken(rawToken: string, meta?: { userAgent?: string; ipAddress?: string }) {
    const tokenHash = this.hash(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
      return null;
    }
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    const newRefresh = await this.issueRefreshToken(existing.userId, meta);
    return { user: existing.user, refreshToken: newRefresh };
  }

  async revokeRefreshToken(rawToken: string) {
    const tokenHash = this.hash(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  hashToken(raw: string) {
    return this.hash(raw);
  }
}
