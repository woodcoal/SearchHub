import { NoKeyAvailableError, type ManagedKey } from '../keys/keyPool.js';
import type { KeyPool } from '../keys/keyPool.js';
import type { Stats } from '../stats/stats.js';
import type { ProviderSettings } from '../store/store.js';
import {
  AllProvidersFailedError,
  asProviderError,
  isKeyFault,
} from './errors.js';
import type { CircuitBreaker } from './circuitBreaker.js';
import type { AttemptLog, SearchProvider, SearchQuery, SearchResponse } from './types.js';

export interface OrchestratorContext {
  providers: SearchProvider[];
  settings: (id: string) => ProviderSettings | undefined;
  pools: Map<string, KeyPool>;
  breakers: Map<string, CircuitBreaker>;
  stats: Stats;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class SearchOrchestrator {
  constructor(private readonly ctx: OrchestratorContext) {}

  /**
   * 主流程：按优先级逐个供应商尝试 → 供应商内逐个密钥尝试 →
   * 密钥故障换 key、供应商故障换供应商，全部失败才抛错。
   */
  async search(
    query: SearchQuery,
    options: { providerId?: string } = {},
  ): Promise<SearchResponse> {
    const started = Date.now();
    const attempts: AttemptLog[] = [];
    const ordered = this.resolveOrder(options.providerId);

    if (ordered.length === 0) {
      const log: AttemptLog = {
        at: started,
        provider: options.providerId ?? '-',
        ok: false,
        code: 'provider_disabled',
        message: options.providerId ? '该供应商不存在或未启用' : '没有已启用的供应商',
        tookMs: 0,
      };
      throw new AllProvidersFailedError([log]);
    }

    let switchedFrom: string | undefined;

    for (const provider of ordered) {
      const settings = this.ctx.settings(provider.id);
      const timeoutMs = settings?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const maxKeyAttempts = Math.max(1, settings?.maxKeyAttempts ?? 3);
      const breaker = this.ctx.breakers.get(provider.id);
      const pool = this.ctx.pools.get(provider.id);

      if (!pool) continue;

      if (breaker && !breaker.allow()) {
        attempts.push({
          at: Date.now(),
          provider: provider.id,
          ok: false,
          code: 'circuit_open',
          message: '熔断中，已跳过',
          tookMs: 0,
        });
        switchedFrom = switchedFrom ?? provider.id;
        continue;
      }

      const ignoredParams = computeIgnoredParams(provider, query);

      for (let attempt = 0; attempt < maxKeyAttempts; attempt += 1) {
        let key: ManagedKey;
        try {
          key = pool.acquire();
        } catch (error) {
          const err = error as NoKeyAvailableError;
          attempts.push({
            at: Date.now(),
            provider: provider.id,
            ok: false,
            code: err.code ?? 'no_key_available',
            message: err.message,
            tookMs: 0,
          });
          break;
        }

        const startedAt = Date.now();
        try {
          const raw = await withTimeout(timeoutMs, (signal) =>
            provider.search({
              query,
              key: { id: key.id, label: key.label, value: key.value },
              signal,
            }),
          );
          const tookMs = Date.now() - startedAt;

          pool.reportSuccess(key.id);
          breaker?.recordSuccess();
          this.ctx.stats.record(provider.id, key.id, true, tookMs);
          attempts.push({
            at: Date.now(),
            provider: provider.id,
            keyId: key.id,
            ok: true,
            tookMs,
          });

          return {
            query,
            results: raw.map((item) => ({ ...item, provider: provider.id })),
            meta: {
              provider: provider.id,
              keyId: key.id,
              tookMs: Date.now() - started,
              degraded: Boolean(switchedFrom),
              switchedFrom,
              ignoredParams,
              attempts,
            },
          };
        } catch (error) {
          const tookMs = Date.now() - startedAt;
          const failure = asProviderError(error);

          pool.reportFailure(key.id, failure);
          if (failure.kind === 'providerUnavailable') breaker?.recordFailure();
          this.ctx.stats.record(provider.id, key.id, false, tookMs, failure.kind, failure.message);
          attempts.push({
            at: Date.now(),
            provider: provider.id,
            keyId: key.id,
            ok: false,
            code: failure.kind,
            message: failure.message,
            tookMs,
          });

          // 密钥问题 → 换下一个 key；其它问题 → 换下一家供应商
          if (!isKeyFault(failure.kind)) break;
        }
      }

      switchedFrom = switchedFrom ?? provider.id;
    }

    throw new AllProvidersFailedError(attempts);
  }

  private resolveOrder(providerId?: string): SearchProvider[] {
    if (providerId) {
      const forced = this.ctx.providers.find((p) => p.id === providerId);
      return forced ? [forced] : [];
    }
    return this.ctx.providers
      .filter((p) => this.ctx.settings(p.id)?.enabled !== false)
      .sort((a, b) => {
        const pa = this.ctx.settings(a.id)?.priority ?? 99;
        const pb = this.ctx.settings(b.id)?.priority ?? 99;
        return pa - pb;
      });
  }
}

/** 供应商不支持的参数静默降级，但必须在响应里告知调用方 */
function computeIgnoredParams(provider: SearchProvider, query: SearchQuery): string[] {
  const ignored: string[] = [];
  const has = (capability: string) => provider.capabilities.includes(capability as never);

  if (query.timeRange && !has('timeRange')) ignored.push('timeRange');
  if (query.site && !has('site')) ignored.push('site');
  if (query.country && !has('country')) ignored.push('country');
  if (query.lang && !has('lang')) ignored.push('lang');
  if ((query.page ?? 1) > 1 && !provider.supportsPaging) ignored.push('page');
  if (query.safeSearch && query.safeSearch !== 'off') ignored.push('safeSearch');

  return ignored;
}

async function withTimeout<T>(
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`请求超时（${ms}ms）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
