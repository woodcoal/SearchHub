export type KeyState = 'active' | 'cooling' | 'quarantined';
export type BreakerState = 'closed' | 'open' | 'half-open';

export interface Counter {
  calls: number;
  success: number;
  failed: number;
  lastOkAt: number | null;
  lastError: string | null;
  lastErrorCode: string | null;
  lastTookMs: number | null;
}

export interface KeyView {
  id: string;
  label: string;
  enabled: boolean;
  state: KeyState;
  cooldownUntil: number | null;
  reason: string | null;
  usedToday: number;
  usedMonth: number;
  usedTotal: number;
  dailyQuota: number | null;
  monthlyQuota: number | null;
  totalQuota: number | null;
  qps: number;
  consecutiveFailures: number;
  lastError: string | null;
  lastErrorCode: string | null;
  lastUsedAt: number | null;
  hint: string;
  createdAt: string;
  stats: Counter;
  /** 密钥自身配置，null 表示继承供应商全局设置（老版本服务端可能不返回） */
  own?: {
    qps: number | null;
    dailyQuota: number | null;
    monthlyQuota: number | null;
    totalQuota: number | null;
  };
}

export interface ProviderSettings {
  id: string;
  enabled: boolean;
  priority: number;
  timeoutMs: number;
  maxKeyAttempts: number;
  failureThreshold: number;
  cooldownMs: number;
  /** 供应商级默认值：密钥未填写时继承 */
  defaultQps: number;
  defaultDailyQuota: number | null;
  defaultMonthlyQuota: number | null;
  defaultTotalQuota: number | null;
}

export interface ProviderView {
  id: string;
  displayName: string;
  docsUrl: string;
  capabilities: string[];
  supportsPaging: boolean;
  settings: ProviderSettings;
  breaker: { state: BreakerState; failures: number; openedAt: number | null; nextProbeAt: number | null };
  stats: Counter;
  keys: KeyView[];
}

export interface AttemptLog {
  at: number;
  provider: string;
  keyId?: string;
  ok: boolean;
  code?: string;
  message?: string;
  tookMs: number;
}

export interface StateSnapshot {
  providers: ProviderView[];
  log: AttemptLog[];
  encryptionEnabled: boolean;
}

export interface SearchMeta {
  provider: string;
  keyId: string;
  tookMs: number;
  degraded: boolean;
  switchedFrom?: string;
  ignoredParams: string[];
  attempts: AttemptLog[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  score?: number;
  provider: string;
}

export interface SearchResponse {
  query: Record<string, unknown>;
  results: SearchResult[];
  meta: SearchMeta;
}

const ADMIN_TOKEN_KEY = 'searchhub.adminToken';

export function getAdminToken(): string {
  return localStorage.getItem(ADMIN_TOKEN_KEY) ?? '';
}

export function setAdminToken(token: string): void {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

async function request<T>(path: string, init: RequestInit = {}, admin = true): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = getAdminToken();
  if (admin && token) headers['x-admin-token'] = token;

  const method = (init.method ?? 'GET').toUpperCase();
  const needsBody = method === 'POST' || method === 'PATCH' || method === 'DELETE';

  const response = await fetch(path, {
    ...init,
    body: init.body ?? (needsBody ? '{}' : undefined),
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    // 优先给出可读信息：message > 逐条校验错误 > error 码
    let message: unknown = payload?.message ?? payload?.error;
    if (!payload?.message && Array.isArray(payload?.issues) && payload.issues.length > 0) {
      message = payload.issues
        .map((issue: { path?: string[]; message?: string }) =>
          `${issue.path?.join('.') || 'body'}: ${issue.message ?? '校验失败'}`,
        )
        .join('; ');
    }
    if (!message) message = `请求失败 (HTTP ${response.status})`;
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }
  return payload as T;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  tail: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
}

export interface SystemSettings {
  homeDir: string;
  dataDir: string;
  dataFile: string;
  logDir: string;
  logRetentionDays: number;
  settingsFile: string;
  passwordSource: 'ui' | 'env';
  passwordUpdatedAt: string | null;
  version: string;
  node: string;
  platform: string;
  uptimeSec: number;
  startedAt: string;
  providers: Array<{
    id: string;
    displayName: string;
    docsUrl: string;
    capabilities: string[];
    supportsPaging: boolean;
    maxPageSize: number;
  }>;
}

export interface MigrationResult {
  dataDir: string;
  dataFile: string;
  logDir: string;
  previousDataFile: string;
  previousLogDir: string;
  movedFiles: string[];
  restarted: boolean;
}

export interface UsageBucket {
  at: string;
  calls: number;
  success: number;
  failed: number;
  avgTookMs: number;
}

export interface UsageCounter {
  calls: number;
  success: number;
  failed: number;
  lastOkAt: number | null;
  lastError: string | null;
  lastErrorCode: string | null;
  lastTookMs: number | null;
  totalTookMs: number;
  lastUsedAt: number | null;
}

export interface UsageSnapshot {
  totals: { calls: number; success: number; failed: number; avgTookMs: number };
  hourly: UsageBucket[];
  daily: UsageBucket[];
  providers: Array<UsageCounter & { id: string }>;
  keys: Array<
    UsageCounter & {
      providerId: string;
      keyId: string;
      label: string;
      hint: string;
      enabled: boolean;
    }
  >;
}

export interface LogEntry {
  level?: number;
  time?: number;
  at?: number;
  msg?: string;
  event?: string;
  ok?: boolean;
  q?: string;
  source?: string;
  requestedProvider?: string | null;
  provider?: string;
  keyId?: string;
  results?: number;
  attempts?: number | Array<{ provider: string; code?: string; message?: string }>;
  degraded?: boolean;
  switchedFrom?: string | null;
  tookMs?: number;
  [key: string]: unknown;
}

export interface LogsResponse {
  date: string;
  dir: string;
  file: string;
  exists: boolean;
  retentionDays: number;
  files: Array<{ name: string; size: number }>;
  total: number;
  skipped: number;
  entries: LogEntry[];
}

export const api = {
  state: () => request<StateSnapshot>('/api/admin/state'),

  usage: () => request<UsageSnapshot>('/api/admin/usage'),

  logs: (options: { date?: string; level?: string; onlySearch?: boolean; keyword?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.date) params.set('date', options.date);
    if (options.level) params.set('level', options.level);
    if (options.onlySearch) params.set('onlySearch', 'true');
    if (options.keyword) params.set('keyword', options.keyword);
    if (options.limit) params.set('limit', String(options.limit));
    const suffix = params.toString();
    return request<LogsResponse>(`/api/admin/logs${suffix ? `?${suffix}` : ''}`);
  },

  settings: () => request<SystemSettings>('/api/admin/settings'),

  updatePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean; updatedAt: string | null }>('/api/admin/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  migrateDataDir: (dir: string) =>
    request<MigrationResult>('/api/admin/data-dir', {
      method: 'POST',
      body: JSON.stringify({ dir }),
    }),

  login: (password: string) =>
    request<{ token: string; expiresAt: number }>(
      '/api/admin/login',
      { method: 'POST', body: JSON.stringify({ password }) },
      false,
    ),

  /** 管理后台调试搜索：走同一套编排逻辑，使用管理员会话鉴权 */
  search: (body: Record<string, unknown>) =>
    request<SearchResponse>('/api/admin/search', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listApiKeys: () =>
    request<{ keys: ApiKeyRecord[]; masterTokenConfigured: boolean }>('/api/admin/api-keys'),

  createApiKey: (name: string) =>
    request<{ key: string; record: ApiKeyRecord }>('/api/admin/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  revokeApiKey: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/api-keys/${id}/revoke`, { method: 'POST' }),

  deleteApiKey: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/api-keys/${id}`, { method: 'DELETE' }),

  updateProvider: (id: string, patch: Partial<ProviderSettings>) =>
    request<{ provider: ProviderSettings }>(`/api/admin/providers/${id}`, {
      method: 'POST',
      body: JSON.stringify(patch),
    }),

  addKey: (input: {
    providerId: string;
    label?: string;
    value: string;
    /** null 表示继承供应商全局设置 */
    qps?: number | null;
    dailyQuota?: number | null;
    monthlyQuota?: number | null;
    totalQuota?: number | null;
  }) =>
    request<{ key: { id: string; label: string } }>('/api/admin/keys', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  patchKey: (
    providerId: string,
    keyId: string,
    patch: {
      label?: string;
      enabled?: boolean;
      qps?: number | null;
      dailyQuota?: number | null;
      monthlyQuota?: number | null;
      totalQuota?: number | null;
      value?: string;
    },
  ) =>
    request<{ key: unknown }>(`/api/admin/keys/${providerId}/${keyId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteKey: (providerId: string, keyId: string) =>
    request<{ ok: boolean }>(`/api/admin/keys/${providerId}/${keyId}`, { method: 'DELETE' }),

  resetKey: (providerId: string, keyId: string) =>
    request<{ ok: boolean }>(`/api/admin/keys/${providerId}/${keyId}/reset`, { method: 'POST' }),

  resetKeyUsage: (providerId: string, keyId: string) =>
    request<{ ok: boolean }>(`/api/admin/keys/${providerId}/${keyId}/reset-usage`, {
      method: 'POST',
    }),

  testKey: (providerId: string, keyId: string) =>
    request<{ ok: boolean; message: string; tookMs: number; results?: number }>(
      `/api/admin/keys/${providerId}/${keyId}/test`,
      { method: 'POST' },
    ),
};
