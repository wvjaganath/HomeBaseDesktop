import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Authenticated encryption (AES-256-GCM) for secrets stored in the DB, such as
 * Google Calendar "secret address" URLs. Format: v1.<iv>.<tag>.<ciphertext>
 * (base64url parts). A stolen DB file alone does not reveal the URLs.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(secretsKeyHex: string, jwtSecret: string) {
    this.key =
      secretsKeyHex.length === 64
        ? Buffer.from(secretsKeyHex, 'hex')
        : Buffer.from(hkdfSync('sha256', jwtSecret, 'homebase-hub', 'secret-box-v1', 32));
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
  }

  open(sealed: string): string {
    const [version, ivB64, tagB64, ctB64] = sealed.split('.');
    if (version !== 'v1' || !ivB64 || !tagB64 || ctB64 === undefined) {
      throw new Error('Unsupported sealed secret format');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
  }
}
