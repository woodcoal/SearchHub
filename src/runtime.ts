import type { AppConfig } from './config.js';
import { CircuitBreaker } from './core/circuitBreaker.js';
import { SearchHub } from './core/hub.js';
import { SearchOrchestrator } from './core/orchestrator.js';
import { KeyPool } from './keys/keyPool.js';
import { SecretBox } from './keys/secretBox.js';
import { PROVIDERS } from './providers/index.js';
import { Stats } from './stats/stats.js';
import { Store } from './store/store.js';

/** 密钥判定无效后的隔离时长：给 6 小时，等人工在界面上复核或自动恢复 */
const QUARANTINE_MS = 6 * 60 * 60 * 1000;
/** 被限流但没有 Retry-After 时的默认冷却 */
const RATE_LIMIT_COOLDOWN_MS = 60_000;

export function createHub(config: AppConfig): SearchHub {
  const secretBox = new SecretBox(config.secret);
  if (!secretBox.enabled) {
    console.warn(
      '[searchhub][warn] 未设置 SEARCHHUB_SECRET，密钥将以明文形式写入数据文件。生产环境务必设置。',
    );
  }

  const store = new Store(config.dataFile, secretBox, config.seedKeys);
  const stats = new Stats();
  const pools = new Map<string, KeyPool>();
  const breakers = new Map<string, CircuitBreaker>();

  for (const provider of PROVIDERS) {
    const settings = store.ensureProvider(provider.id);
    pools.set(
      provider.id,
      new KeyPool(provider.id, {
        quarantineMs: QUARANTINE_MS,
        rateLimitCooldownMs: RATE_LIMIT_COOLDOWN_MS,
      }),
    );
    breakers.set(
      provider.id,
      new CircuitBreaker({
        failureThreshold: settings.failureThreshold,
        cooldownMs: settings.cooldownMs,
      }),
    );
  }

  const orchestrator = new SearchOrchestrator({
    providers: PROVIDERS,
    settings: (id) => store.getProvider(id),
    pools,
    breakers,
    stats,
  });

  const hub = new SearchHub({
    store,
    stats,
    pools,
    breakers,
    providers: PROVIDERS,
    orchestrator,
    encryptionEnabled: secretBox.enabled,
    settings: config.settings,
    config,
  });

  hub.refreshAllPools();
  return hub;
}
