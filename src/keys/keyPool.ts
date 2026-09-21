import { nextUtcMidnight, utcDayStamp } from '../core/date.js';
import type { ProviderError } from '../core/errors.js';

export type KeyState = 'active' | 'cooling' | 'quarantined';

export interface ManagedKey {
  id: string;
  label: string;
  value: string;
  enabled: boolean;
  qps: number;
  dailyQuota: number | null;
}

export interface KeyRuntimeView {
  id: string;
  label: string;
  enabled: boolean;
  state: KeyState;
  cooldownUntil: number | null;
  reason: string | null;
  usedToday: number;
  dailyQuota: number | null;
  qps: number;
  consecutiveFailures: number;
  lastError: string | null;
  lastErrorCode: string | null;
  lastUsedAt: number | null;
}

export interface KeyPoolOptions {
  /** 密钥判定无效后的隔离时长 */
  quarantineMs: number;
  /** 被限流但没有 Retry-After 时的默认冷却时长 */
  rateLimitCooldownMs: number;
}

export class NoKeyAvailableError extends Error {
  readonly code = 'no_key_available';
  constructor(message: string) {
    super(message);
    this.name = 'NoKeyAvailableError';
  }
}

interface Runtime {
  id: string;
  label: string;
  enabled: boolean;
  qps: number;
  dailyQuota: number | null;
  state: KeyState;
  cooldownUntil: number | null;
  reason: string | null;
  usedToday: number;
  dayStamp: string;
  tokens: number;
  lastRefillAt: number;
  consecutiveFailures: number;
  lastError: string | null;
  lastErrorCode: string | null;
  lastUsedAt: number | null;
}

/**
 * 单个供应商的密钥池：轮换选取 + QPS 令牌桶 + 日配额 + 冷却/隔离状态机。
 * 冷却与配额属于运行时状态，进程重启后清零（多实例部署需换 Redis，见 README）。
 */
export class KeyPool {
  private readonly runtime = new Map<string, Runtime>();
  private readonly values = new Map<string, string>();
  private order: string[] = [];
  private cursor = 0;

  constructor(
    readonly providerId: string,
    private readonly options: KeyPoolOptions,
  ) {}

  /** 用持久化配置刷新运行时状态，保留已有冷却/计数 */
  sync(keys: ManagedKey[]): void {
    const seen = new Set<string>();

    for (const key of keys) {
      seen.add(key.id);
      this.values.set(key.id, key.value);
      const existing = this.runtime.get(key.id);
      if (!existing) {
        this.runtime.set(key.id, {
          id: key.id,
          label: key.label,
          enabled: key.enabled,
          qps: key.qps,
          dailyQuota: key.dailyQuota,
          state: 'active',
          cooldownUntil: null,
          reason: null,
          usedToday: 0,
          dayStamp: utcDayStamp(),
          tokens: key.qps,
          lastRefillAt: Date.now(),
          consecutiveFailures: 0,
          lastError: null,
          lastErrorCode: null,
          lastUsedAt: null,
        });
        continue;
      }
      existing.label = key.label;
      existing.enabled = key.enabled;
      existing.qps = key.qps;
      existing.dailyQuota = key.dailyQuota;
    }

    for (const id of [...this.runtime.keys()]) {
      if (!seen.has(id)) {
        this.runtime.delete(id);
        this.values.delete(id);
      }
    }

    this.order = keys.map((k) => k.id);
    if (this.cursor >= this.order.length) this.cursor = 0;
  }

  /** 按轮询 + 令牌桶挑一个可用密钥，没有则抛出 NoKeyAvailableError */
  acquire(): ManagedKey {
    const now = Date.now();
    const candidates = this.order.filter((id) => this.runtime.get(id)?.enabled);
    if (candidates.length === 0) throw new NoKeyAvailableError('没有已启用的密钥');

    for (let i = 0; i < candidates.length; i += 1) {
      const index = (this.cursor + i) % candidates.length;
      const id = candidates[index]!;
      const entry = this.runtime.get(id)!;

      this.refresh(entry, now);
      if (entry.state !== 'active') continue;

      this.refill(entry, now);
      if (entry.tokens < 1) continue;
      entry.tokens -= 1;

      this.cursor = (index + 1) % candidates.length;
      entry.lastUsedAt = now;
      entry.usedToday += 1;

      return {
        id,
        label: entry.label,
        value: this.values.get(id) ?? '',
        enabled: entry.enabled,
        qps: entry.qps,
        dailyQuota: entry.dailyQuota,
      };
    }

    throw new NoKeyAvailableError('所有密钥均处于冷却/隔离状态或已达速率上限');
  }

  /** 按 id 直接取密钥（用于界面上的「测试密钥」，跳过冷却/状态判断） */
  pickById(id: string): ManagedKey | undefined {
    const entry = this.runtime.get(id);
    if (!entry) return undefined;
    this.refill(entry, Date.now());
    entry.lastUsedAt = Date.now();
    entry.usedToday += 1;
    return {
      id,
      label: entry.label,
      value: this.values.get(id) ?? '',
      enabled: entry.enabled,
      qps: entry.qps,
      dailyQuota: entry.dailyQuota,
    };
  }

  reportSuccess(id: string): void {
    const entry = this.runtime.get(id);
    if (!entry) return;
    entry.consecutiveFailures = 0;
    entry.lastError = null;
    entry.lastErrorCode = null;
  }

  reportFailure(id: string, error: ProviderError): void {
    const entry = this.runtime.get(id);
    if (!entry) return;

    entry.consecutiveFailures += 1;
    entry.lastError = error.message;
    entry.lastErrorCode = error.kind;

    const now = Date.now();
    switch (error.kind) {
      case 'keyInvalid':
        entry.state = 'quarantined';
        entry.cooldownUntil = now + this.options.quarantineMs;
        entry.reason = '密钥无效';
        break;
      case 'keyRateLimited':
        entry.state = 'cooling';
        entry.cooldownUntil = now + (error.retryAfterMs ?? this.options.rateLimitCooldownMs);
        entry.reason = '被限流';
        break;
      case 'keyQuotaExhausted':
        entry.state = 'quarantined';
        entry.cooldownUntil = nextUtcMidnight(now);
        entry.reason = '配额耗尽';
        break;
      default:
        // providerUnavailable / badRequest 不是密钥的锅，不惩罚密钥
        break;
    }
  }

  /** 界面上的「重新启用」：立即解除冷却/隔离 */
  resetKey(id: string): void {
    const entry = this.runtime.get(id);
    if (!entry) return;
    entry.state = 'active';
    entry.cooldownUntil = null;
    entry.reason = null;
    entry.consecutiveFailures = 0;
    entry.lastError = null;
    entry.lastErrorCode = null;
  }

  snapshot(): KeyRuntimeView[] {
    const now = Date.now();
    return this.order.map((id) => {
      const entry = this.runtime.get(id)!;
      this.refresh(entry, now);
      return {
        id: entry.id,
        label: entry.label,
        enabled: entry.enabled,
        state: entry.state,
        cooldownUntil: entry.cooldownUntil,
        reason: entry.reason,
        usedToday: entry.usedToday,
        dailyQuota: entry.dailyQuota,
        qps: entry.qps,
        consecutiveFailures: entry.consecutiveFailures,
        lastError: entry.lastError,
        lastErrorCode: entry.lastErrorCode,
        lastUsedAt: entry.lastUsedAt,
      };
    });
  }

  private refresh(entry: Runtime, now: number): void {
    if (entry.dayStamp !== utcDayStamp(now)) {
      entry.dayStamp = utcDayStamp(now);
      entry.usedToday = 0;
      if (entry.reason === '配额耗尽') {
        entry.state = 'active';
        entry.cooldownUntil = null;
        entry.reason = null;
      }
    }

    if (entry.state !== 'active' && entry.cooldownUntil !== null && now >= entry.cooldownUntil) {
      entry.state = 'active';
      entry.cooldownUntil = null;
      entry.reason = null;
      entry.consecutiveFailures = 0;
    }

    if (
      entry.state === 'active' &&
      entry.dailyQuota !== null &&
      entry.usedToday >= entry.dailyQuota
    ) {
      entry.state = 'quarantined';
      entry.cooldownUntil = nextUtcMidnight(now);
      entry.reason = '配额耗尽';
    }
  }

  private refill(entry: Runtime, now: number): void {
    const elapsedSeconds = (now - entry.lastRefillAt) / 1000;
    entry.tokens = Math.min(entry.qps, entry.tokens + elapsedSeconds * entry.qps);
    entry.lastRefillAt = now;
  }
}
