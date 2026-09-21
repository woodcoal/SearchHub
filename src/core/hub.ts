import { KeyPool, type KeyRuntimeView, type ManagedKey } from '../keys/keyPool.js';
import { findProvider } from '../providers/index.js';
import { Stats, type Counter } from '../stats/stats.js';
import {
  Store,
  type KeyPatch,
  type NewKeyInput,
  type ProviderPatch,
  type ProviderSettings,
  type StoredKey,
} from '../store/store.js';
import { CircuitBreaker, type BreakerSnapshot } from './circuitBreaker.js';
import { FAULT_LABELS, asProviderError } from './errors.js';
import { SearchOrchestrator } from './orchestrator.js';
import type { AttemptLog, SearchProvider, SearchQuery, SearchResponse } from './types.js';

export interface KeyView extends KeyRuntimeView {
  hint: string;
  createdAt: string;
  stats: Counter;
}

export interface ProviderView {
  id: string;
  displayName: string;
  docsUrl: string;
  capabilities: string[];
  supportsPaging: boolean;
  settings: ProviderSettings;
  breaker: BreakerSnapshot;
  stats: Counter;
  keys: KeyView[];
}

export interface HealthView {
  id: string;
  displayName: string;
  enabled: boolean;
  breaker: BreakerSnapshot;
  keySummary: { total: number; active: number; cooling: number; quarantined: number };
  stats: Counter;
}

export interface StateSnapshot {
  providers: ProviderView[];
  log: AttemptLog[];
  encryptionEnabled: boolean;
}

export interface HubDeps {
  store: Store;
  stats: Stats;
  pools: Map<string, KeyPool>;
  breakers: Map<string, CircuitBreaker>;
  providers: SearchProvider[];
  orchestrator: SearchOrchestrator;
  encryptionEnabled: boolean;
}

export class SearchHub {
  constructor(private readonly deps: HubDeps) {}

  get store(): Store {
    return this.deps.store;
  }

  get stats(): Stats {
    return this.deps.stats;
  }

  search(query: SearchQuery, options: { providerId?: string } = {}): Promise<SearchResponse> {
    return this.deps.orchestrator.search(query, options);
  }

  /** 用指定密钥打一次真实请求，用于界面上的连通性测试 */
  async testKey(
    providerId: string,
    keyId: string,
    q = 'searchhub connectivity test',
  ): Promise<{ ok: boolean; message: string; tookMs: number; results?: number }> {
    const provider = findProvider(providerId);
    if (!provider) throw new Error(`未知供应商: ${providerId}`);
    const pool = this.deps.pools.get(providerId);
    if (!pool) throw new Error(`供应商未注册: ${providerId}`);
    const key = pool.pickById(keyId);
    if (!key) throw new Error('密钥不存在');

    const started = Date.now();
    try {
      const results = await provider.search({
        query: { q, pageSize: 3 },
        key: { id: key.id, label: key.label, value: key.value },
        signal: AbortSignal.timeout(15_000),
      });
      const tookMs = Date.now() - started;
      pool.reportSuccess(key.id);
      this.deps.stats.record(providerId, key.id, true, tookMs);
      return { ok: true, message: `连通正常，返回 ${results.length} 条结果`, tookMs, results: results.length };
    } catch (error) {
      const failure = asProviderError(error);
      const tookMs = Date.now() - started;
      pool.reportFailure(key.id, failure);
      this.deps.stats.record(providerId, key.id, false, tookMs, failure.kind, failure.message);
      return { ok: false, message: `${FAULT_LABELS[failure.kind]}: ${failure.message}`, tookMs };
    }
  }

  state(): StateSnapshot {
    const now = Date.now();
    const providers: ProviderView[] = this.deps.providers.map((provider) => {
      const settings = this.deps.store.getProvider(provider.id) ?? this.deps.store.ensureProvider(provider.id);
      const pool = this.deps.pools.get(provider.id);
      const runtimeKeys = pool ? pool.snapshot() : [];
      const stored = new Map(this.deps.store.listKeys(provider.id).map((k) => [k.id, k]));

      const keys: KeyView[] = runtimeKeys.map((runtime) => {
        const record = stored.get(runtime.id);
        return {
          ...runtime,
          hint: record ? this.mask(record) : '',
          createdAt: record?.createdAt ?? '',
          stats: this.deps.stats.keyStats(provider.id, runtime.id),
        };
      });

      return {
        id: provider.id,
        displayName: provider.displayName,
        docsUrl: provider.docsUrl,
        capabilities: [...provider.capabilities],
        supportsPaging: provider.supportsPaging,
        settings,
        breaker: this.deps.breakers.get(provider.id)?.snapshot() ?? {
          state: 'closed',
          failures: 0,
          openedAt: null,
          nextProbeAt: null,
        },
        stats: this.deps.stats.providerStats(provider.id),
        keys,
      };
    });

    return {
      providers,
      log: this.deps.stats.recentLog(30),
      encryptionEnabled: this.deps.encryptionEnabled,
    };
  }

  health(): HealthView[] {
    return this.deps.providers.map((provider) => {
      const settings = this.deps.store.getProvider(provider.id);
      const keys = this.deps.pools.get(provider.id)?.snapshot() ?? [];
      return {
        id: provider.id,
        displayName: provider.displayName,
        enabled: settings?.enabled !== false,
        breaker: this.deps.breakers.get(provider.id)?.snapshot() ?? {
          state: 'closed',
          failures: 0,
          openedAt: null,
          nextProbeAt: null,
        },
        keySummary: {
          total: keys.length,
          active: keys.filter((k) => k.state === 'active' && k.enabled).length,
          cooling: keys.filter((k) => k.state === 'cooling').length,
          quarantined: keys.filter((k) => k.state === 'quarantined').length,
        },
        stats: this.deps.stats.providerStats(provider.id),
      };
    });
  }

  addKey(providerId: string, input: NewKeyInput): StoredKey {
    const key = this.deps.store.addKey(providerId, input);
    this.refreshPool(providerId);
    return key;
  }

  updateKey(providerId: string, keyId: string, patch: KeyPatch, value?: string): StoredKey {
    const key = value
      ? this.deps.store.updateKeyValue(providerId, keyId, value)
      : this.deps.store.updateKey(providerId, keyId, patch);
    this.refreshPool(providerId);
    return key;
  }

  removeKey(providerId: string, keyId: string): void {
    this.deps.store.removeKey(providerId, keyId);
    this.refreshPool(providerId);
  }

  resetKey(providerId: string, keyId: string): void {
    this.deps.pools.get(providerId)?.resetKey(keyId);
  }

  updateProvider(id: string, patch: ProviderPatch): ProviderSettings {
    const settings = this.deps.store.updateProvider(id, patch);
    // 熔断参数变更需要重建熔断器
    this.deps.breakers.set(
      id,
      new CircuitBreaker({
        failureThreshold: settings.failureThreshold,
        cooldownMs: settings.cooldownMs,
      }),
    );
    return settings;
  }

  refreshPool(providerId: string): void {
    const pool = this.deps.pools.get(providerId);
    if (pool) pool.sync(this.keysOf(providerId));
  }

  refreshAllPools(): void {
    for (const id of this.deps.pools.keys()) this.refreshPool(id);
  }

  private keysOf(providerId: string): ManagedKey[] {
    return this.deps.store.listKeys(providerId).map((record) => {
      let value = '';
      try {
        value = this.deps.store.decrypt(record.secret);
      } catch {
        value = '';
      }
      return {
        id: record.id,
        label: record.label,
        value,
        enabled: record.enabled,
        qps: record.qps,
        dailyQuota: record.dailyQuota,
      };
    });
  }

  /** 密钥摘要：只回后 4 位，方便界面辨认是哪一把，绝不回传完整密钥 */
  private mask(record: StoredKey): string {
    try {
      const value = this.deps.store.decrypt(record.secret);
      return value.length > 8 ? `****${value.slice(-4)}` : '****';
    } catch {
      return '<无法解密>';
    }
  }
}
