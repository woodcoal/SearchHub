import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

export interface AppConfig {
  port: number;
  host: string;
  logLevel: string;
  dataFile: string;
  secret: string | undefined;
  /** 管理后台登录密码（明文来自环境变量，运行时只保留哈希） */
  adminPassword: string;
  /** 密码是否为自动生成的（启动时需打印提示） */
  adminPasswordGenerated: boolean;
  /** 登录会话有效期 */
  sessionTtlMs: number;
  /** 主 API Key（环境变量形式，优先级高于数据库里的 key，便于应急/CI） */
  apiToken: string | undefined;
  /** 主管理令牌（环境变量形式，便于脚本调用管理接口） */
  adminToken: string | undefined;
  /** 首次启动时从环境变量播种的密钥 */
  seedKeys: Record<string, string[]>;
}

function splitKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? 8787);
  const providedPassword = env.SEARCHHUB_ADMIN_PASSWORD?.trim();

  return {
    port: Number.isFinite(port) ? port : 8787,
    host: env.HOST ?? '0.0.0.0',
    logLevel: env.LOG_LEVEL ?? 'info',
    dataFile: resolve(env.DATA_FILE ?? './data/store.json'),
    secret: env.SEARCHHUB_SECRET || undefined,
    adminPassword: providedPassword || randomBytes(9).toString('base64url'),
    adminPasswordGenerated: !providedPassword,
    sessionTtlMs: Number(env.SEARCHHUB_SESSION_TTL_MS ?? 8 * 60 * 60 * 1000),
    apiToken: env.SEARCHHUB_API_TOKEN || undefined,
    adminToken: env.SEARCHHUB_ADMIN_TOKEN || undefined,
    seedKeys: {
      serper: splitKeys(env.SERPER_KEYS),
      exa: splitKeys(env.EXA_KEYS),
    },
  };
}
