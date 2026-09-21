import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { AppConfig } from '../config.js';
import { KeyPool, type KeyRuntimeView, type ManagedKey } from '../keys/keyPool.js';
import { logFiles } from '../logging.js';
import type { SettingsStore } from '../settings.js';
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
  /** 密钥自身配置（null 表示继承供应商全局设置，界面上用它回填编辑表单） */
  own: {
    qps: number | null;
    dailyQuota: number | null;
    monthlyQuota: number | null;
    totalQuota: number | null;
  };
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
  /** 权重：越小越优先 */
  priority: number;
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

export interface DataDirMigration {
  dataDir: string;
  dataFile: string;
  logDir: string;
  previousDataFile: string;
  previousLogDir: string;
  movedFiles: string[];
  restarted: boolean;
}

export interface HubDeps {
  store: Store;
  stats: Stats;
  pools: Map<string, KeyPool>;
  breakers: Map<string, CircuitBreaker>;
  providers: SearchProvider[];
  orchestrator: SearchOrchestrator;
  encryptionEnabled: boolean;
  settings: SettingsStore;
  config: AppConfig;
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
          own: {
            qps: record?.qps ?? null,
            dailyQuota: record?.dailyQuota ?? null,
            monthlyQuota: record?.monthlyQuota ?? null,
            totalQuota: record?.totalQuota ?? null,
          },
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
      // 按权重排序：priority 越小越优先，界面上「优先的排前面」
      providers: providers.sort(
        (a, b) => a.settings.priority - b.settings.priority || a.id.localeCompare(b.id),
      ),
      log: this.deps.stats.recentLog(30),
      encryptionEnabled: this.deps.encryptionEnabled,
    };
  }

  health(): HealthView[] {
    return this.deps.providers
      .map((provider) => {
        const settings = this.deps.store.getProvider(provider.id);
        const keys = this.deps.pools.get(provider.id)?.snapshot() ?? [];
        return {
          id: provider.id,
          displayName: provider.displayName,
          priority: settings?.priority ?? 99,
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
      })
      // 权重小的排前面，与 state() 一致
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }

  addKey(providerId: string, input: NewKeyInput): StoredKey {
    const key = this.deps.store.addKey(providerId, input);
    this.refreshPool(providerId);
    return key;
  }

  updateKey(providerId: string, keyId: string, patch: KeyPatch, value?: string): StoredKey {
    // 密钥内容与其它字段要同时生效，不能只走其中一支
    if (value) this.deps.store.updateKeyValue(providerId, keyId, value);
    const hasPatch = Object.keys(patch).length > 0;
    const key = hasPatch
      ? this.deps.store.updateKey(providerId, keyId, patch)
      : this.deps.store.listKeys(providerId).find((k) => k.id === keyId)!;
    this.refreshPool(providerId);
    // 换了新密钥内容就当作一把全新的密钥，清除冷却/隔离与连续失败计数
    if (value) this.deps.pools.get(providerId)?.resetKey(keyId);
    return key;
  }

  removeKey(providerId: string, keyId: string): void {
    this.deps.store.removeKey(providerId, keyId);
    this.refreshPool(providerId);
  }

  resetKey(providerId: string, keyId: string): void {
    this.deps.pools.get(providerId)?.resetKey(keyId);
  }

  /** 清零用量计数并解除隔离（总配额耗尽后需要它才能继续用） */
  resetKeyUsage(providerId: string, keyId: string): void {
    this.deps.pools.get(providerId)?.resetUsage(keyId);
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

  /**
   * 切换数据目录并把现有数据迁移过去：
   * 数据文件整体写入新位置，历史日志文件一并搬移（正在写入的当天日志除外），
   * 设置写入 settings.json，随后日志立即改用新目录。
   */
  setDataDir(dir: string): DataDirMigration {
    const target = resolve(dir.trim());
    if (!target) throw new Error('目录不能为空');
    mkdirSync(target, { recursive: true });

    const previousDataFile = this.store.path;
    const previousLogDir = this.deps.config.logDir;
    const nextDataFile = join(target, 'store.json');
    const nextLogDir = join(target, 'log');
    const movedFiles: string[] = [];

    if (resolve(previousDataFile) !== resolve(nextDataFile)) {
      movedFiles.push(this.store.retarget(nextDataFile));
    }

    if (resolve(previousLogDir) !== resolve(nextLogDir) && existsSync(previousLogDir)) {
      mkdirSync(nextLogDir, { recursive: true });
      const inUse = join(previousLogDir, `searchhub-${new Date().toISOString().slice(0, 10)}.log`);
      for (const name of logFiles(previousLogDir)) {
        const source = join(previousLogDir, name);
        const destination = join(nextLogDir, name);
        if (resolve(source) === resolve(inUse)) continue; // 当天日志正在写入，留在原处
        if (existsSync(destination)) continue;
        try {
          renameSync(source, destination);
          movedFiles.push(destination);
        } catch {
          // 文件被占用（Windows 常见），跳过，下次迁移时再搬
        }
      }
    }

    this.deps.settings.setDataDir(target);
    this.deps.config.dataDir = target;
    this.deps.config.dataFile = nextDataFile;
    this.deps.config.logDir = nextLogDir;
    this.refreshAllPools();

    return {
      dataDir: target,
      dataFile: nextDataFile,
      logDir: nextLogDir,
      previousDataFile,
      previousLogDir,
      movedFiles,
      restarted: false,
    };
  }

  refreshPool(providerId: string): void {
    const pool = this.deps.pools.get(providerId);
    if (pool) pool.sync(this.keysOf(providerId));
  }

  refreshAllPools(): void {
    for (const id of this.deps.pools.keys()) this.refreshPool(id);
  }

  /**
   * 构造密钥池配置：密钥自身没填的字段回退到供应商级全局设置，
   * 全局也没设则视为不限（QPS 至少为 1，否则永远取不到令牌）。
   */
  private keysOf(providerId: string): ManagedKey[] {
    const provider = this.deps.store.getProvider(providerId);
    const globalQps = provider?.defaultQps ?? 1;
    const globalDaily = provider?.defaultDailyQuota ?? null;
    const globalMonthly = provider?.defaultMonthlyQuota ?? null;
    const globalTotal = provider?.defaultTotalQuota ?? null;

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
        qps: record.qps ?? globalQps,
        dailyQuota: record.dailyQuota ?? globalDaily,
        monthlyQuota: record.monthlyQuota ?? globalMonthly,
        totalQuota: record.totalQuota ?? globalTotal,
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
