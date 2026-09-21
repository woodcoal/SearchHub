import { ProviderError } from '../core/errors.js';
import { parseLooseDate } from '../core/date.js';
import type { ProviderRequest, RawResult, SearchProvider, TimeRange } from '../core/types.js';
import { clampPageSize, extractMessage, postJson, type JsonResponse } from './http.js';

const ENDPOINT = 'https://google.serper.dev/search';

/** Serper 用 Google 的 tbs 参数表达时间范围 */
const TIME_RANGE_TBS: Record<TimeRange, string> = {
  day: 'qdr:d',
  week: 'qdr:w',
  month: 'qdr:m',
  year: 'qdr:y',
};

export const serperProvider: SearchProvider = {
  id: 'serper',
  displayName: 'Serper（Google SERP）',
  docsUrl: 'https://serper.dev/',
  capabilities: ['web', 'timeRange', 'site', 'country', 'lang'],
  supportsPaging: true,
  defaultPageSize: 10,
  maxPageSize: 50,

  async search({ query, key, signal }: ProviderRequest): Promise<RawResult[]> {
    const pageSize = clampPageSize(query.pageSize, this.defaultPageSize, this.maxPageSize);
    const q = query.site ? `${query.q} site:${query.site}` : query.q;

    const body: Record<string, unknown> = {
      q,
      num: pageSize,
      page: Math.max(1, query.page ?? 1),
    };
    if (query.country) body.gl = query.country;
    if (query.lang) body.hl = query.lang;
    if (query.timeRange) body.tbs = TIME_RANGE_TBS[query.timeRange];

    const response = await postJson(ENDPOINT, {
      headers: { 'X-API-KEY': key.value },
      body,
      signal,
    });

    if (response.status < 200 || response.status >= 300) throw classify(response);

    const organic = Array.isArray(response.json?.organic) ? response.json!.organic : [];
    return organic
      .filter((item: any) => typeof item?.link === 'string')
      .map((item: any): RawResult => ({
        title: typeof item.title === 'string' ? item.title : item.link,
        url: item.link,
        snippet: typeof item.snippet === 'string' ? item.snippet : '',
        publishedAt: parseLooseDate(item.date),
      }));
  },
};

function classify(response: JsonResponse): ProviderError {
  const message = extractMessage(response);
  const lower = message.toLowerCase();
  const opts = { status: response.status, retryAfterMs: response.retryAfterMs, raw: message };

  if (response.status === 400) return new ProviderError('badRequest', `Serper 拒绝请求: ${message}`, opts);
  if (response.status === 402 || lower.includes('quota') || lower.includes('credits')) {
    return new ProviderError('keyQuotaExhausted', `Serper 配额耗尽: ${message}`, opts);
  }
  if (response.status === 401 || response.status === 403) {
    return new ProviderError('keyInvalid', `Serper 密钥无效: ${message}`, opts);
  }
  if (response.status === 429) {
    return new ProviderError('keyRateLimited', `Serper 限流: ${message}`, opts);
  }
  if (response.status >= 500) {
    return new ProviderError('providerUnavailable', `Serper 服务异常: ${message}`, opts);
  }
  return new ProviderError('providerUnavailable', `Serper 未知响应: ${message}`, opts);
}
