import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (existsSync('.env')) {
  console.log('Existing .env preserved. Check its database and storage settings before starting local services.');
} else {
  const template = readFileSync('.env.example', 'utf8');
  const values = {
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    R2_ACCOUNT_ID: 'local',
    R2_ACCESS_KEY_ID: 'S3RVER',
    R2_SECRET_ACCESS_KEY: 'S3RVER',
    R2_REGION: 'us-east-1',
  };
  let env = template;
  for (const [key, value] of Object.entries(values)) {
    env = env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
  }
  env += '\n# Local S3 emulator; production uses Cloudflare R2.\nR2_ENDPOINT=http://127.0.0.1:4569\n';
  writeFileSync('.env', env);
  console.log('Created .env with local database/storage settings and generated JWT secrets.');
}
