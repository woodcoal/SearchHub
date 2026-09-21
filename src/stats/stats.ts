import type { AttemptLog } from '../core/types.js';
import { FileCallLog, type CallLogPersistence } from './callLog.js';

export interface Counter {
  calls: number;
  success: number;
  failed: number;
  lastOkAt: number | null;
  lastError: string | null;
  lastErrorCode: string | null;
  lastTookMs: number | null;
  /** 累计耗时，用于算平均 */
  totalTookMs: number;
  lastUsedAt: number | null;
}

export interface UsageBucket {
  /** 本地时区的 'YYYY-MM-DD HH' 或 'YYYY-MM-DD' */
  at: string;
  calls: number;
  success: number;
  failed: number;
  avgTookMs: number;
}

export interface UsageSnapshot {
  totals: { calls: number; success: number; failed: number; avgTookMs: number };
  hourly: UsageBucket[];
  daily: UsageBucket[];
  providers: Array<Counter & { id: string }>;
  keys: Array<Counter & { providerId: string; keyId: string }>;
}

interface RawBucket {
  calls: number;
  success: number;
  failed: number;
  tookMs: number;
}

const EMPTY: Counter = {
  calls: 0,
  success: 0,
  failed: 0,
  lastOkAt: null,
  lastError: null,
  lastErrorCode: null,
  lastTookMs: null,
  totalTookMs: 0,
  lastUsedAt: null,
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const KEEP_HOURS = 26;
const KEEP_DAYS = 15;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function hourKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}`;
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 运行时统计：计数与时间桶是内存态（重启清零），
 * 调用日志（每次密钥/供应商尝试的记录）会同步落盘，重启后自动加载。
 * 多实例部署时把这里换成 Redis 即可，接口保持不变。
 */
export class Stats {
  private readonly providers = new Map<string, Counter>();
  private readonly keys = new Map<string, Counter>();
  private readonly hourly = new Map<string, RawBucket>();
  private readonly daily = new Map<string, RawBucket>();
  private log: AttemptLog[] = [];
  private readonly logLimit: number;

  constructor(
    logLimit = 1000,
    private readonly persistence?: CallLogPersistence,
  ) {
    this.logLimit = logLimit;
    if (persistence) {
      this.log = persistence.load().slice(0, logLimit);
      if (persistence.needsCompact()) persistence.compact(this.log);
    }
  }

  /** 调用日志文件的落地路径（未启用持久化时为空） */
  get logFile(): string | null {
    return this.persistence instanceof FileCallLog ? this.persistence.path : null;
  }

  record(
    providerId: string,
    keyId: string | undefined,
    ok: boolean,
    tookMs: number,
    code?: string,
    message?: string,
  ): void {
    const now = Date.now();

    const provider = this.providers.get(providerId) ?? { ...EMPTY };
    applyCounter(provider, ok, tookMs, now, code, message);
    this.providers.set(providerId, provider);

    if (keyId) {
      const key = this.keys.get(`${providerId}:${keyId}`) ?? { ...EMPTY };
      applyCounter(key, ok, tookMs, now, code, message);
      this.keys.set(`${providerId}:${keyId}`, key);
    }

    bump(this.hourly, hourKey(now), ok, tookMs);
    bump(this.daily, dayKey(now), ok, tookMs);
    this.prune(now);

    const entry: AttemptLog = { at: now, provider: providerId, keyId, ok, code, message, tookMs };
    this.log.unshift(entry);
    if (this.log.length > this.logLimit) this.log.length = this.logLimit;

    if (this.persistence) {
      this.persistence.append(entry);
      // 追加够一轮就整体重写一次，文件大小稳定在保留条数的 1~2 倍
      if (this.persistence.needsCompact()) this.persistence.compact(this.log);
    }
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

  /** 汇总用量：总计 + 最近 24 小时/14 天趋势 + 分供应商/分密钥明细 */
  usage(now = Date.now()): UsageSnapshot {
    let calls = 0;
    let success = 0;
    let failed = 0;
    let tookMs = 0;
    for (const counter of this.providers.values()) {
      calls += counter.calls;
      success += counter.success;
      failed += counter.failed;
      tookMs += counter.totalTookMs;
    }

    const hourly: UsageBucket[] = [];
    for (let i = KEEP_HOURS - 3; i >= 0; i -= 1) {
      const at = now - i * HOUR_MS;
      hourly.push(toBucket(hourKey(at), this.hourly.get(hourKey(at))));
    }

    const daily: UsageBucket[] = [];
    for (let i = KEEP_DAYS - 2; i >= 0; i -= 1) {
      const at = now - i * DAY_MS;
      daily.push(toBucket(dayKey(at), this.daily.get(dayKey(at))));
    }

    return {
      totals: {
        calls,
        success,
        failed,
        avgTookMs: calls > 0 ? Math.round(tookMs / calls) : 0,
      },
      hourly,
      daily,
      providers: [...this.providers.entries()]
        .map(([id, counter]) => ({ id, ...counter }))
        .sort((a, b) => b.calls - a.calls),
      keys: [...this.keys.entries()]
        .map(([composite, counter]) => {
          const [providerId, keyId] = composite.split(':');
          return { providerId: providerId!, keyId: keyId!, ...counter };
        })
        .sort((a, b) => b.calls - a.calls),
    };
  }

  private prune(now: number): void {
    const hourFloor = hourKey(now - KEEP_HOURS * HOUR_MS);
    for (const key of [...this.hourly.keys()]) {
      if (key < hourFloor) this.hourly.delete(key);
    }
    const dayFloor = dayKey(now - KEEP_DAYS * DAY_MS);
    for (const key of [...this.daily.keys()]) {
      if (key < dayFloor) this.daily.delete(key);
    }
  }
}

function emptyBucket(): RawBucket {
  return { calls: 0, success: 0, failed: 0, tookMs: 0 };
}

function applyCounter(
  counter: Counter,
  ok: boolean,
  tookMs: number,
  now: number,
  code?: string,
  message?: string,
): void {
  counter.calls += 1;
  counter.totalTookMs += tookMs;
  counter.lastTookMs = tookMs;
  counter.lastUsedAt = now;
  if (ok) {
    counter.success += 1;
    counter.lastOkAt = now;
    counter.lastError = null;
    counter.lastErrorCode = null;
  } else {
    counter.failed += 1;
    counter.lastError = message ?? null;
    counter.lastErrorCode = code ?? null;
  }
}

function bump(map: Map<string, RawBucket>, key: string, ok: boolean, tookMs: number): void {
  const bucket = map.get(key) ?? emptyBucket();
  bucket.calls += 1;
  bucket.tookMs += tookMs;
  if (ok) bucket.success += 1;
  else bucket.failed += 1;
  map.set(key, bucket);
}

function toBucket(at: string, raw?: RawBucket): UsageBucket {
  return {
    at,
    calls: raw?.calls ?? 0,
    success: raw?.success ?? 0,
    failed: raw?.failed ?? 0,
    avgTookMs: raw && raw.calls > 0 ? Math.round(raw.tookMs / raw.calls) : 0,
  };
}
