import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get nodeEnv() {
    return this.config.get('NODE_ENV', { infer: true });
  }
  get isProd() {
    return this.nodeEnv === 'production';
  }
  get port() {
    return this.config.get('PORT', { infer: true });
  }
  get appUrl() {
    return this.config.get('APP_URL', { infer: true });
  }
  get corsOrigins(): string[] {
    return this.config
      .get('CORS_ORIGINS', { infer: true })
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  get databaseUrl() {
    return this.config.get('DATABASE_URL', { infer: true });
  }
  get jwtAccessSecret() {
    return this.config.get('JWT_ACCESS_SECRET', { infer: true });
  }
  get jwtAccessTtl() {
    return this.config.get('JWT_ACCESS_TTL', { infer: true });
  }
  get jwtRefreshSecret() {
    return this.config.get('JWT_REFRESH_SECRET', { infer: true });
  }
  get jwtRefreshTtl() {
    return this.config.get('JWT_REFRESH_TTL', { infer: true });
  }
  get r2AccountId() {
    return this.config.get('R2_ACCOUNT_ID', { infer: true });
  }
  /** S3 API URL for R2 (defaults to Cloudflare’s endpoint for this account). */
  get r2Endpoint() {
    const explicit = this.config.get('R2_ENDPOINT', { infer: true });
    if (explicit) return explicit;
    const id = this.r2AccountId;
    return `https://${id}.r2.cloudflarestorage.com`;
  }
  get r2Bucket() {
    return this.config.get('R2_BUCKET', { infer: true });
  }
  get r2AccessKeyId() {
    return this.config.get('R2_ACCESS_KEY_ID', { infer: true });
  }
  get r2SecretAccessKey() {
    return this.config.get('R2_SECRET_ACCESS_KEY', { infer: true });
  }
  get r2Region() {
    return this.config.get('R2_REGION', { infer: true });
  }
  get r2PresignExpires() {
    return this.config.get('R2_PRESIGN_EXPIRES_SECONDS', { infer: true });
  }
  get seedAdmin() {
    return {
      email: this.config.get('SEED_ADMIN_EMAIL', { infer: true }),
      password: this.config.get('SEED_ADMIN_PASSWORD', { infer: true }),
      firstName: this.config.get('SEED_ADMIN_FIRST_NAME', { infer: true }),
      lastName: this.config.get('SEED_ADMIN_LAST_NAME', { infer: true }),
    };
  }
}
