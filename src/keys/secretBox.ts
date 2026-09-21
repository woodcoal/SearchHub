import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * 密钥落盘加密。设置 SEARCHHUB_SECRET 后使用 AES-256-GCM；
 * 未设置时退化为「明文 + 启动告警」，保证本地开发仍可用。
 */
export class SecretBox {
  private readonly key: Buffer | null;

  constructor(secret?: string) {
    this.key = secret && secret.length > 0 ? scryptSync(secret, 'searchhub-key-v1', 32) : null;
  }

  get enabled(): boolean {
    return this.key !== null;
  }

  encrypt(plain: string): string {
    if (!this.key) return `plain:${Buffer.from(plain, 'utf8').toString('base64')}`;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
  }

  decrypt(payload: string): string {
    if (payload.startsWith('plain:')) {
      return Buffer.from(payload.slice('plain:'.length), 'base64').toString('utf8');
    }
    const [version, iv, tag, data] = payload.split(':');
    if (version !== 'v1') throw new Error(`不支持的密钥密文格式: ${version ?? '未知'}`);
    if (!this.key) throw new Error('密钥已加密但未提供 SEARCHHUB_SECRET，无法解密');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv!, 'base64'));
    decipher.setAuthTag(Buffer.from(tag!, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data!, 'base64')), decipher.final()]).toString('utf8');
  }
}
