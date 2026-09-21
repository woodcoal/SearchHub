import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { defaultHome } from './logging.js';
import { SettingsStore } from './settings.js';

export interface AppConfig {
  port: number;
  host: string;
  logLevel: string;
  /** 默认根目录 ~/.search-hub */
  homeDir: string;
  /** 系统设置（数据目录、后台密码） */
  settings: SettingsStore;
  /** 实际数据目录：settings.dataDir ?? homeDir */
  dataDir: string;
  /** 数据文件（供应商设置 + 密钥密文 + API Key 哈希） */
  dataFile: string;
  /** 日志目录，默认 <dataDir>/log */
  logDir: string;
  /** 日志保留天数，<=0 表示永久保留 */
  logRetentionDays: number;
  /** 是否同时输出到 stdout */
  logToStdout: boolean;
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

function toInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? 8787);
  const providedPassword = env.SEARCHHUB_ADMIN_PASSWORD?.trim();

  const settingsFile = env.SEARCHHUB_SETTINGS_FILE
    ? resolve(env.SEARCHHUB_SETTINGS_FILE)
    : SettingsStore.defaultPath(env);
  const settings = new SettingsStore(settingsFile);

  const homeDir = env.SEARCHHUB_HOME?.trim() ? resolve(env.SEARCHHUB_HOME.trim()) : defaultHome();
  const dataDir = settings.dataDir ?? homeDir;

  return {
    port: Number.isFinite(port) ? port : 8787,
    host: env.HOST ?? '0.0.0.0',
    logLevel: env.LOG_LEVEL ?? 'info',
    homeDir,
    settings,
    dataDir,
    dataFile: env.DATA_FILE ? resolve(env.DATA_FILE) : join(dataDir, 'store.json'),
    logDir: env.SEARCHHUB_LOG_DIR ? resolve(env.SEARCHHUB_LOG_DIR) : join(dataDir, 'log'),
    logRetentionDays: toInt(env.SEARCHHUB_LOG_RETENTION_DAYS, 14),
    logToStdout: env.SEARCHHUB_LOG_STDOUT !== 'false',
    secret: env.SEARCHHUB_SECRET || undefined,
    adminPassword: providedPassword || randomBytes(9).toString('base64url'),
    adminPasswordGenerated: !providedPassword,
    sessionTtlMs: toInt(env.SEARCHHUB_SESSION_TTL_MS, 8 * 60 * 60 * 1000),
    apiToken: env.SEARCHHUB_API_TOKEN || undefined,
    adminToken: env.SEARCHHUB_ADMIN_TOKEN || undefined,
    seedKeys: {
      serper: splitKeys(env.SERPER_KEYS),
      exa: splitKeys(env.EXA_KEYS),
    },
  };
}
