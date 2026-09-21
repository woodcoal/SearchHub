import type { AttemptLog } from '../core/types.js';

export interface Counter {
  calls: number;
  success: number;
  failed: number;
  lastOkAt: number | null;
  lastError: string | null;
  lastErrorCode: string | null;
  lastTookMs: number | null;
}

const EMPTY: Counter = {
  calls: 0,
  success: 0,
  failed: 0,
  lastOkAt: null,
  lastError: null,
  lastErrorCode: null,
  lastTookMs: null,
};

/**
 * 运行时统计：内存态，重启清零。
 * 多实例部署时把这里换成 Redis 即可，接口保持不变。
 */
export class Stats {
  private readonly providers = new Map<string, Counter>();
  private readonly keys = new Map<string, Counter>();
  private readonly log: AttemptLog[] = [];
  private readonly logLimit: number;

  constructor(logLimit = 100) {
    this.logLimit = logLimit;
  }

  record(
    providerId: string,
    keyId: string | undefined,
    ok: boolean,
    tookMs: number,
    code?: string,
    message?: string,
  ): void {
    const provider = this.providers.get(providerId) ?? { ...EMPTY };
    provider.calls += 1;
    if (ok) {
      provider.success += 1;
      provider.lastOkAt = Date.now();
      provider.lastError = null;
      provider.lastErrorCode = null;
    } else {
      provider.failed += 1;
      provider.lastError = message ?? null;
      provider.lastErrorCode = code ?? null;
    }
    provider.lastTookMs = tookMs;
    this.providers.set(providerId, provider);

    if (keyId) {
      const key = this.keys.get(`${providerId}:${keyId}`) ?? { ...EMPTY };
      key.calls += 1;
      if (ok) {
        key.success += 1;
        key.lastOkAt = Date.now();
        key.lastError = null;
        key.lastErrorCode = null;
      } else {
        key.failed += 1;
        key.lastError = message ?? null;
        key.lastErrorCode = code ?? null;
      }
      key.lastTookMs = tookMs;
      this.keys.set(`${providerId}:${keyId}`, key);
    }

    this.log.unshift({
      at: Date.now(),
      provider: providerId,
      keyId,
      ok,
      code,
      message,
      tookMs,
    });
    if (this.log.length > this.logLimit) this.log.length = this.logLimit;
  }

  providerStats(providerId: string): Counter {
    return this.providers.get(providerId) ?? { ...EMPTY };
  }

  keyStats(providerId: string, keyId: string): Counter {
    return this.keys.get(`${providerId}:${keyId}`) ?? { ...EMPTY };
  }

  recentLog(limit = 30): AttemptLog[] {
    return this.log.slice(0, limit);
  }
}
