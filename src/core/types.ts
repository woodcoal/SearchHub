/** 统一搜索协议：对外只暴露这一套模型，屏蔽各家 API 差异。 */

export type Capability = 'web' | 'timeRange' | 'site' | 'country' | 'lang';

export type TimeRange = 'day' | 'week' | 'month' | 'year';

export type SafeSearch = 'off' | 'moderate' | 'strict';

export interface SearchQuery {
  /** 检索词 */
  q: string;
  /** 页码，从 1 开始 */
  page?: number;
  /** 每页条数，默认 10，上限 50 */
  pageSize?: number;
  /** 国家/地区，ISO 3166-1 alpha-2，如 us / cn */
  country?: string;
  /** 语言，如 en / zh */
  lang?: string;
  timeRange?: TimeRange;
  /** 站内限定，如 example.com */
  site?: string;
  safeSearch?: SafeSearch;
}

/** 供应商适配器返回的原始结果，provider 字段由编排层补充 */
export interface RawResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  score?: number;
  thumbnail?: string;
}

export interface SearchResult extends RawResult {
  provider: string;
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

export interface SearchMeta {
  /** 实际命中的供应商 */
  provider: string;
  /** 实际使用的密钥（已脱敏为 id，不含密钥内容） */
  keyId: string;
  tookMs: number;
  /** 是否发生过降级（主供应商失败后切换） */
  degraded: boolean;
  switchedFrom?: string;
  /** 该供应商不支持、被静默忽略的查询参数 */
  ignoredParams: string[];
  attempts: AttemptLog[];
}

export interface SearchResponse {
  query: SearchQuery;
  results: SearchResult[];
  meta: SearchMeta;
}

/** 交给适配器的密钥（内存中短暂存在，绝不落日志） */
export interface ResolvedKey {
  id: string;
  label: string;
  value: string;
}

export interface ProviderRequest {
  query: SearchQuery;
  key: ResolvedKey;
  signal: AbortSignal;
}

export interface SearchProvider {
  id: string;
  displayName: string;
  docsUrl: string;
  capabilities: Capability[];
  /** 是否支持翻页（Exa 的 /search 不支持 offset 翻页） */
  supportsPaging: boolean;
  defaultPageSize: number;
  maxPageSize: number;
  search(req: ProviderRequest): Promise<RawResult[]>;
}
