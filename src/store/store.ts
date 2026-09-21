import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { SecretBox } from '../keys/secretBox.js';

export interface ProviderSettings {
  id: string;
  enabled: boolean;
  /** 数字越小越优先 */
  priority: number;
  timeoutMs: number;
  /** 单个供应商内最多尝试几个密钥 */
  maxKeyAttempts: number;
  /** 连续失败多少次触发熔断 */
  failureThreshold: number;
  /** 熔断后冷却时长 */
  cooldownMs: number;
  /** 供应商级默认 QPS：密钥未单独填写时继承 */
  defaultQps: number;
  /** 供应商级默认日配额：密钥未填写时继承 */
  defaultDailyQuota: number | null;
  /** 供应商级默认月配额 */
  defaultMonthlyQuota: number | null;
  /** 供应商级默认总配额 */
  defaultTotalQuota: number | null;
}

export interface StoredKey {
  id: string;
  label: string;
  /** 密文（由 SecretBox 生成） */
  secret: string;
  enabled: boolean;
  /** QPS，null 表示继承供应商全局设置 */
  qps: number | null;
  /** 日配额，null 表示继承供应商全局设置 */
  dailyQuota: number | null;
  /** 月配额，null 表示继承供应商全局设置（每月 1 号 UTC 0 点重置） */
  monthlyQuota: number | null;
  /** 总配额，null 表示继承供应商全局设置（不随时间恢复，需手动调整） */
  totalQuota: number | null;
  createdAt: string;
}

/** 调用方接入统一搜索接口用的 API Key，只存哈希 */
export interface StoredApiKey {
  id: string;
  name: string;
  hash: string;
  prefix: string;
  tail: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
}

export interface StoreData {
  version: number;
  providers: Record<string, ProviderSettings>;
  keys: Record<string, StoredKey[]>;
  apiKeys: StoredApiKey[];
}

export type ProviderPatch = Partial<Omit<ProviderSettings, 'id'>>;

export interface NewKeyInput {
  label?: string;
  value: string;
  enabled?: boolean;
  /** 留空（null）表示继承供应商全局设置 */
  qps?: number | null;
  dailyQuota?: number | null;
  monthlyQuota?: number | null;
  totalQuota?: number | null;
}

export type KeyPatch = Partial<
  Pick<StoredKey, 'label' | 'enabled' | 'qps' | 'dailyQuota' | 'monthlyQuota' | 'totalQuota'>
>;

const VERSION = 1;

const PROVIDER_BASE = {
  enabled: true,
  maxKeyAttempts: 3,
  failureThreshold: 5,
  cooldownMs: 60_000,
  defaultQps: 1,
  defaultDailyQuota: null,
  defaultMonthlyQuota: null,
  defaultTotalQuota: null,
} as const;

/** 把存量配置与默认值逐字段合并，保证升级后新增字段有值 */
function mergeProviders(
  stored: Record<string, Partial<ProviderSettings>> | undefined,
): Record<string, ProviderSettings> {
  const merged: Record<string, ProviderSettings> = {};
  for (const [id, defaults] of Object.entries(DEFAULT_PROVIDERS)) {
    merged[id] = { ...defaults, ...(stored?.[id] ?? {}), id };
  }
  for (const [id, settings] of Object.entries(stored ?? {})) {
    if (!merged[id]) {
      merged[id] = { ...PROVIDER_BASE, priority: 99, timeoutMs: 10_000, ...settings, id };
    }
  }
  return merged;
}

const DEFAULT_PROVIDERS: Record<string, ProviderSettings> = {
  serper: { ...PROVIDER_BASE, id: 'serper', priority: 1, timeoutMs: 10_000 },
  tavily: { ...PROVIDER_BASE, id: 'tavily', priority: 2, timeoutMs: 12_000 },
  exa: { ...PROVIDER_BASE, id: 'exa', priority: 3, timeoutMs: 15_000 },
  anysearch: { ...PROVIDER_BASE, id: 'anysearch', priority: 4, timeoutMs: 12_000 },
};

/**
 * 供应商设置 + 密钥密文的持久化。单文件 JSON + 原子写入，
 * 规模上去了再换数据库，接口不用动。
 */
export class Store {
  private data: StoreData;

  constructor(
    private file: string,
    private readonly secretBox: SecretBox,
    seed: Record<string, string[]> = {},
  ) {
    this.data = this.load(seed);
  }

  get path(): string {
    return this.file;
  }

  private load(seed: Record<string, string[]>): StoreData {
    const target = resolve(this.file);
    if (existsSync(target)) {
      try {
        const parsed = JSON.parse(readFileSync(target, 'utf8')) as StoreData;
        return {
          version: VERSION,
          // 逐供应商深合并：老数据文件缺的新字段（如 defaultQps）用默认值补齐
          providers: mergeProviders(parsed.providers),
          keys: parsed.keys ?? {},
          apiKeys: parsed.apiKeys ?? [],
        };
      } catch (error) {
        throw new Error(`数据文件解析失败 (${target}): ${(error as Error).message}`);
      }
    }

    const data: StoreData = {
      version: VERSION,
      providers: structuredClone(DEFAULT_PROVIDERS),
      keys: {},
      apiKeys: [],
    };
    for (const [providerId, values] of Object.entries(seed)) {
      for (const value of values) {
        if (!value.trim()) continue;
        const list = data.keys[providerId] ?? [];
        list.push({
          id: randomUUID(),
          label: `${providerId}-${list.length + 1}`,
          secret: this.secretBox.encrypt(value.trim()),
          enabled: true,
          qps: null,
          dailyQuota: null,
          monthlyQuota: null,
          totalQuota: null,
          createdAt: new Date().toISOString(),
        });
        data.keys[providerId] = list;
      }
    }
    this.data = data;
    this.persist();
    return data;
  }

  private persist(): void {
    const target = resolve(this.file);
    mkdirSync(dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    renameSync(tmp, target);
  }

  private save(): void {
    this.persist();
  }

  /**
   * 迁移到新的数据文件：把当前内存中的数据完整写入新位置，
   * 目标已存在时先备份为 .bak-<时间戳>，随后所有写入走新文件。
   */
  retarget(newFile: string): string {
    const target = resolve(newFile);
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target) && resolve(target) !== resolve(this.file)) {
      renameSync(target, `${target}.bak-${Date.now()}`);
    }
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    renameSync(tmp, target);
    this.file = target;
    return target;
  }

  listProviders(): ProviderSettings[] {
    return Object.values(this.data.providers).sort((a, b) => a.priority - b.priority);
  }

  getProvider(id: string): ProviderSettings | undefined {
    return this.data.providers[id];
  }

  /** 保证供应商设置存在（新增适配器代码后自动补齐默认配置） */
  ensureProvider(id: string): ProviderSettings {
    if (!this.data.providers[id]) {
      this.data.providers[id] = { ...PROVIDER_BASE, id, priority: 99, timeoutMs: 10_000 };
      this.save();
    }
    return this.data.providers[id]!;
  }

  updateProvider(id: string, patch: ProviderPatch): ProviderSettings {
    const current = this.data.providers[id];
    if (!current) throw new Error(`未知供应商: ${id}`);
    const next: ProviderSettings = { ...current, ...patch, id: current.id };
    this.data.providers[id] = next;
    this.save();
    return next;
  }

  listKeys(providerId: string): StoredKey[] {
    return this.data.keys[providerId] ?? [];
  }

  addKey(providerId: string, input: NewKeyInput): StoredKey {
    if (!this.data.providers[providerId]) throw new Error(`未知供应商: ${providerId}`);
    const list = this.data.keys[providerId] ?? [];
    const key: StoredKey = {
      id: randomUUID(),
      label: input.label?.trim() || `${providerId}-${list.length + 1}`,
      secret: this.secretBox.encrypt(input.value),
      enabled: input.enabled ?? true,
      qps: input.qps ?? null,
      dailyQuota: input.dailyQuota ?? null,
      monthlyQuota: input.monthlyQuota ?? null,
      totalQuota: input.totalQuota ?? null,
      createdAt: new Date().toISOString(),
    };
    list.push(key);
    this.data.keys[providerId] = list;
    this.save();
    return key;
  }

  updateKey(providerId: string, keyId: string, patch: KeyPatch): StoredKey {
    const list = this.data.keys[providerId];
    const key = list?.find((k) => k.id === keyId);
    if (!key) throw new Error(`密钥不存在: ${providerId}/${keyId}`);
    Object.assign(key, patch);
    this.save();
    return key;
  }

  updateKeyValue(providerId: string, keyId: string, value: string): StoredKey {
    const list = this.data.keys[providerId];
    const key = list?.find((k) => k.id === keyId);
    if (!key) throw new Error(`密钥不存在: ${providerId}/${keyId}`);
    key.secret = this.secretBox.encrypt(value);
    this.save();
    return key;
  }

  removeKey(providerId: string, keyId: string): void {
    const list = this.data.keys[providerId];
    if (!list) throw new Error(`密钥不存在: ${providerId}/${keyId}`);
    this.data.keys[providerId] = list.filter((k) => k.id !== keyId);
    this.save();
  }

  decrypt(secret: string): string {
    return this.secretBox.decrypt(secret);
  }

  listApiKeys(): StoredApiKey[] {
    return this.data.apiKeys;
  }

  addApiKey(record: Omit<StoredApiKey, 'id' | 'createdAt' | 'lastUsedAt' | 'revoked'>): StoredApiKey {
    const key: StoredApiKey = {
      ...record,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revoked: false,
    };
    this.data.apiKeys.push(key);
    this.save();
    return key;
  }

  findApiKeyByHash(hash: string): StoredApiKey | undefined {
    return this.data.apiKeys.find((k) => k.hash === hash && !k.revoked);
  }

  touchApiKey(id: string): void {
    const key = this.data.apiKeys.find((k) => k.id === id);
    if (!key) return;
    key.lastUsedAt = new Date().toISOString();
    this.save();
  }

  revokeApiKey(id: string): StoredApiKey {
    const key = this.data.apiKeys.find((k) => k.id === id);
    if (!key) throw new Error('API Key 不存在');
    key.revoked = true;
    this.save();
    return key;
  }

  removeApiKey(id: string): void {
    const exists = this.data.apiKeys.some((k) => k.id === id);
    if (!exists) throw new Error('API Key 不存在');
    this.data.apiKeys = this.data.apiKeys.filter((k) => k.id !== id);
    this.save();
  }
}
