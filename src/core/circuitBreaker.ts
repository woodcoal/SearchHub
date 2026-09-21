export type BreakerState = 'closed' | 'open' | 'half-open';

export interface BreakerConfig {
  /** 连续失败多少次后跳闸 */
  failureThreshold: number;
  /** 跳闸后冷却多久（ms）再放行探测请求 */
  cooldownMs: number;
  /** 半开状态允许放行的探测请求数 */
  halfOpenMaxCalls?: number;
}

export interface BreakerSnapshot {
  state: BreakerState;
  failures: number;
  openedAt: number | null;
  nextProbeAt: number | null;
}

/**
 * 供应商级熔断器：只针对「供应商整体故障」计数，
 * 单个 key 失效不算供应商故障（那是 KeyPool 的职责）。
 */
export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private failures = 0;
  private openedAt: number | null = null;
  private probes = 0;

  constructor(private readonly config: BreakerConfig) {}

  allow(): boolean {
    if (this.state === 'closed') return true;

    const now = Date.now();
    if (this.state === 'open') {
      if (this.openedAt !== null && now - this.openedAt >= this.config.cooldownMs) {
        this.state = 'half-open';
        this.probes = 0;
      } else {
        return false;
      }
    }

    return this.probes < (this.config.halfOpenMaxCalls ?? 1);
  }

  recordSuccess(): void {
    this.state = 'closed';
    this.failures = 0;
    this.probes = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    this.probes += 1;
    if (this.state === 'half-open') {
      this.trip();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.config.failureThreshold) this.trip();
  }

  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.probes = 0;
    this.openedAt = null;
  }

  private trip(): void {
    this.state = 'open';
    this.openedAt = Date.now();
    this.probes = 0;
  }

  snapshot(): BreakerSnapshot {
    return {
      state: this.state,
      failures: this.failures,
      openedAt: this.openedAt,
      nextProbeAt:
        this.state === 'open' && this.openedAt !== null
          ? this.openedAt + this.config.cooldownMs
          : null,
    };
  }
}
