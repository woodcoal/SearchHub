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
}

export interface ProviderSettings {
  id: string;
  enabled: boolean;
  priority: number;
  timeoutMs: number;
  maxKeyAttempts: number;
  failureThreshold: number;
  cooldownMs: number;
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
    const message =
      payload?.message ?? payload?.error ?? `请求失败 (HTTP ${response.status})`;
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

export const api = {
  state: () => request<StateSnapshot>('/api/admin/state'),

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
    qps?: number;
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
      qps?: number;
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
