import type { AttemptLog } from './types.js';

/**
 * 故障分类是整个容灾体系的地基：
 * - key*   → 密钥自身的问题，换下一个 key 重试
 * - providerUnavailable → 供应商整体故障，换下一家供应商
 * - badRequest → 请求本身有问题，重试没有意义
 */
export type FaultKind =
  | 'keyInvalid'
  | 'keyRateLimited'
  | 'keyQuotaExhausted'
  | 'providerUnavailable'
  | 'badRequest';

export interface ProviderErrorOptions {
  status?: number;
  retryAfterMs?: number;
  raw?: unknown;
}

export class ProviderError extends Error {
  readonly kind: FaultKind;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly raw?: unknown;

  constructor(kind: FaultKind, message: string, options: ProviderErrorOptions = {}) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.raw = options.raw;
  }
}

export function isKeyFault(kind: FaultKind): boolean {
  return kind === 'keyInvalid' || kind === 'keyRateLimited' || kind === 'keyQuotaExhausted';
}

export class AllProvidersFailedError extends Error {
  readonly attempts: AttemptLog[];

  constructor(attempts: AttemptLog[]) {
    super('所有搜索供应商均不可用');
    this.name = 'AllProvidersFailedError';
    this.attempts = attempts;
  }
}

/** 归一化未知异常，避免非 ProviderError 逃逸导致编排逻辑错乱 */
export function asProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return new ProviderError('providerUnavailable', `请求超时: ${err.message}`);
    }
    return new ProviderError('providerUnavailable', err.message);
  }
  return new ProviderError('providerUnavailable', String(err));
}

export const FAULT_LABELS: Record<FaultKind, string> = {
  keyInvalid: '密钥无效',
  keyRateLimited: '密钥被限流',
  keyQuotaExhausted: '密钥配额耗尽',
  providerUnavailable: '供应商不可用',
  badRequest: '请求参数错误',
};
