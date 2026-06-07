import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_REFRESH_TTL: z.string().default('7d'),

  /** Cloudflare account ID (used to build the default R2 S3 API endpoint). */
  R2_ACCOUNT_ID: z.string().min(1),
  /** Optional override for the R2 S3 API base URL. */
  R2_ENDPOINT: z.string().url().optional(),
  R2_BUCKET: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_REGION: z.string().default('auto'),
  R2_PRESIGN_EXPIRES_SECONDS: z.coerce.number().int().positive().default(900),

  SEED_ADMIN_EMAIL: z.string().email().default('admin@babulilm.local'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('ChangeMe123!'),
  SEED_ADMIN_FIRST_NAME: z.string().default('School'),
  SEED_ADMIN_LAST_NAME: z.string().default('Admin'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => ` - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}
