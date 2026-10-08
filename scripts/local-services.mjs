import EmbeddedPostgres from 'embedded-postgres';
import S3rver from 's3rver';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

process.loadEnvFile();
const databaseUrl = new URL(process.env.DATABASE_URL);
const storageUrl = new URL(process.env.R2_ENDPOINT);
const localHosts = ['localhost', '127.0.0.1'];
if (!localHosts.includes(databaseUrl.hostname) || !localHosts.includes(storageUrl.hostname)) {
  throw new Error('Local services require local DATABASE_URL and R2_ENDPOINT settings.');
}
const databaseDir = resolve('.local/postgres');
const storageDir = resolve('.local/storage');
mkdirSync(storageDir, { recursive: true });
const postgres = new EmbeddedPostgres({
  databaseDir,
  user: decodeURIComponent(databaseUrl.username),
  password: decodeURIComponent(databaseUrl.password),
  port: Number(databaseUrl.port || 5432),
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-h', '127.0.0.1'],
});
const origins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map((s) => s.trim());
const escapeXml = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const cors = `<CORSConfiguration><CORSRule>${origins.map((s) => `<AllowedOrigin>${escapeXml(s)}</AllowedOrigin>`).join('')}<AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader></CORSRule></CORSConfiguration>`;
const storage = new S3rver({
  address: '127.0.0.1',
  port: Number(storageUrl.port),
  directory: storageDir,
  silent: true,
  resetOnClose: false,
  configureBuckets: [{ name: process.env.R2_BUCKET, configs: [cors] }],
});
let databaseStarted = false;
let storageStarted = false;
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (storageStarted) await storage.close();
  if (databaseStarted) await postgres.stop();
}
try {
  if (!existsSync(resolve(databaseDir, 'PG_VERSION'))) await postgres.initialise();
  await postgres.start();
  databaseStarted = true;
  const client = postgres.getPgClient();
  await client.connect();
  const name = decodeURIComponent(databaseUrl.pathname.slice(1));
  const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  await client.end();
  if (!result.rowCount) await postgres.createDatabase(name);
  await storage.run();
  storageStarted = true;
  console.log(`Local PostgreSQL ready on 127.0.0.1:${databaseUrl.port || 5432}`);
  console.log(`Local uploads ready on ${storageUrl.origin}; data persists in .local/`);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => shutdown().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); }));
  }
} catch (error) {
  await shutdown();
  console.error(error);
  process.exit(1);
}
