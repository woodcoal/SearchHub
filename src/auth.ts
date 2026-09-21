import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** 管理后台密码：scrypt 加盐哈希，不存明文 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 32).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, expected] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const actual = Buffer.from(scryptSync(password, salt, 32).toString('hex'), 'hex');
  const target = Buffer.from(expected, 'hex');
  return actual.length === target.length && timingSafeEqual(actual, target);
}

/** API Key 用 sha256 即可（key 本身是 192bit 随机串，无法暴力枚举） */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(): {
  key: string;
  hash: string;
  prefix: string;
  tail: string;
} {
  const key = `sh_${randomBytes(24).toString('base64url')}`;
  return {
    key,
    hash: hashApiKey(key),
    prefix: key.slice(0, 10),
    tail: key.slice(-4),
  };
}

/**
 * 登录会话令牌：`v1.<过期时间>.<HMAC>`。
 * 密钥混入密码哈希，改密码后旧令牌立即失效。
 */
export class SessionTokens {
  constructor(private readonly secret: string) {}

  issue(ttlMs: number): { token: string; expiresAt: number } {
    const expiresAt = Date.now() + ttlMs;
    const payload = String(expiresAt);
    const signature = createHmac('sha256', this.secret).update(payload).digest('base64url');
    return { token: `v1.${payload}.${signature}`, expiresAt };
  }

  verify(token: string | undefined | null): boolean {
    if (!token) return false;
    const [version, payload, signature] = token.split('.');
    if (version !== 'v1' || !payload || !signature) return false;

    const expected = createHmac('sha256', this.secret).update(payload).digest('base64url');
    const given = Buffer.from(signature);
    const want = Buffer.from(expected);
    if (given.length !== want.length) return false;
    if (!timingSafeEqual(given, want)) return false;

    return Number(payload) > Date.now();
  }
}
