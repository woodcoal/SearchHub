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
  /** 是否已应用过「按免费额度预设默认值」的迁移（第 1 版） */
  quotaDefaultsSeeded?: boolean;
  /** 「按免费额度预设默认值」的迁移版本号，用于后续更新默认值时再次迁移 */
  quotaSeedVersion?: number;
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

/**
 * 各家的默认 QPS 与配额，按「免费额度」设定，避免默认值把免费额度一把烧完：
 * - serper：QPS 5；免费一次性 2500 credits 且不按月重置 → 只设总配额
 * - tavily：QPS 5；免费 1000 credits/月（basic 搜索 1 credit）→ 月配额 1000
 * - exa：QPS 10；免费 tier 每月 $10 额度（约 1400 次搜索，保守取 1000）→ 月配额 1000
 * - anysearch：QPS 20；免费 key 日限额 1000 → 只设日配额
 * 日配额只给明确有日限额的 anysearch 设置，其余留空（不限）；
 * 这些值都可以在「供应商配置」里按实际套餐改。
 */
const DEFAULT_PROVIDERS: Record<string, ProviderSettings> = {
  serper: {
    ...PROVIDER_BASE,
    id: 'serper',
    priority: 1,
    timeoutMs: 10_000,
    defaultQps: 5,
    defaultTotalQuota: 2500,
  },
  tavily: {
    ...PROVIDER_BASE,
    id: 'tavily',
    priority: 2,
    timeoutMs: 12_000,
    defaultQps: 5,
    defaultMonthlyQuota: 1000,
  },
  exa: {
    ...PROVIDER_BASE,
    id: 'exa',
    priority: 3,
    timeoutMs: 15_000,
    defaultQps: 10,
    defaultMonthlyQuota: 1000,
  },
  anysearch: {
    ...PROVIDER_BASE,
    id: 'anysearch',
    priority: 4,
    timeoutMs: 12_000,
    defaultQps: 20,
    defaultDailyQuota: 1000,
  },
};

/** 默认配额的迁移版本：每次调整内置默认值就 +1，并在 seedQuotas 里补一段迁移 */
const QUOTA_SEED_VERSION = 2;

/** 上一版（v1）的内置默认值，用来判断用户是否手动改过 */
const PREVIOUS_DEFAULTS: Record<
  string,
  Pick<ProviderSettings, 'defaultQps' | 'defaultDailyQuota' | 'defaultMonthlyQuota' | 'defaultTotalQuota'>
> = {
  serper: { defaultQps: 1, defaultDailyQuota: null, defaultMonthlyQuota: null, defaultTotalQuota: 2500 },
  tavily: { defaultQps: 1, defaultDailyQuota: 100, defaultMonthlyQuota: 1000, defaultTotalQuota: null },
  exa: { defaultQps: 1, defaultDailyQuota: 100, defaultMonthlyQuota: 1000, defaultTotalQuota: null },
  anysearch: { defaultQps: 1, defaultDailyQuota: null, defaultMonthlyQuota: null, defaultTotalQuota: null },
};

const QUOTA_FIELDS = [
  'defaultQps',
  'defaultDailyQuota',
  'defaultMonthlyQuota',
  'defaultTotalQuota',
] as const;

/**
 * 按版本把内置默认配额迁移到存量配置上。
 * 规则：只有当前值仍等于上一版内置默认值时才覆盖，用户手动改过的一律保留。
 */
function seedQuotas(current: ProviderSettings, defaults: ProviderSettings, fromVersion: number): void {
  if (fromVersion < 1) {
    // 首次引入默认配额：只把「未设置」的字段填上
    current.defaultDailyQuota = current.defaultDailyQuota ?? defaults.defaultDailyQuota;
    current.defaultMonthlyQuota = current.defaultMonthlyQuota ?? defaults.defaultMonthlyQuota;
    current.defaultTotalQuota = current.defaultTotalQuota ?? defaults.defaultTotalQuota;
  }
  if (fromVersion < 2) {
    const previous = PREVIOUS_DEFAULTS[current.id];
    if (previous) {
      for (const field of QUOTA_FIELDS) {
        if (current[field] === previous[field]) {
          (current[field] as ProviderSettings[typeof field]) = defaults[field];
        }
      }
    }
  }
}

/**
 * 把存量配置与默认值逐字段合并，保证升级后新增字段有值，
 * 并按 `fromVersion` 应用默认配额迁移。
 */
function mergeProviders(
  stored: Record<string, Partial<ProviderSettings>> | undefined,
  fromVersion: number,
): Record<string, ProviderSettings> {
  const merged: Record<string, ProviderSettings> = {};
  for (const [id, defaults] of Object.entries(DEFAULT_PROVIDERS)) {
    const current = { ...defaults, ...(stored?.[id] ?? {}), id };
    if (fromVersion < QUOTA_SEED_VERSION) seedQuotas(current, defaults, fromVersion);
    merged[id] = current;
  }
  for (const [id, settings] of Object.entries(stored ?? {})) {
    if (!merged[id]) {
      merged[id] = { ...PROVIDER_BASE, priority: 99, timeoutMs: 10_000, ...settings, id };
    }
  }
  return merged;
}

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
    const { data, seeded } = this.load(seed);
    this.data = data;
    // 首次应用「按免费额度预设的默认配额」时落盘一次，之后不再覆盖用户选择
    if (seeded) this.save();
  }

  get path(): string {
    return this.file;
  }

  private load(seed: Record<string, string[]>): { data: StoreData; seeded: boolean } {
    const target = resolve(this.file);
    if (existsSync(target)) {
      try {
        const parsed = JSON.parse(readFileSync(target, 'utf8')) as StoreData;
        // 老数据文件没有版本号：有 quotaDefaultsSeeded 视为已做过第 1 版迁移
        const fromVersion = parsed.quotaSeedVersion ?? (parsed.quotaDefaultsSeeded ? 1 : 0);
        const seeded = fromVersion < QUOTA_SEED_VERSION;
        return {
          data: {
            version: VERSION,
            // 逐供应商深合并：老数据文件缺的新字段（如 defaultQps）用默认值补齐
            providers: mergeProviders(parsed.providers, fromVersion),
            keys: parsed.keys ?? {},
            apiKeys: parsed.apiKeys ?? [],
            quotaDefaultsSeeded: true,
            quotaSeedVersion: QUOTA_SEED_VERSION,
          },
          seeded,
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
      quotaDefaultsSeeded: true,
      quotaSeedVersion: QUOTA_SEED_VERSION,
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
    // 首次创建数据文件：这里直接落盘，构造函数不再重复保存
    this.data = data;
    this.persist();
    return { data, seeded: false };
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
