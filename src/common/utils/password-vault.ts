import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Admin-issued passwords are kept encrypted (AES-256-GCM) so an admin can view them again until the user sets their
 * own password (then the stored copy is cleared). The key is derived from an existing server secret, so no new
 * environment variable is needed. If that secret ever changes, old copies simply become unreadable (admin resets).
 */
export class PasswordVault {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash('sha256').update(`babulilm:issued-password:v1:${secret}`).digest();
  }

  seal(raw: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
    return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')}`;
  }

  open(sealed: string | null | undefined): string | null {
    if (!sealed || !sealed.startsWith('v1:')) return null;
    try {
      const buf = Buffer.from(sealed.slice(3), 'base64');
      const decipher = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
      decipher.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}
