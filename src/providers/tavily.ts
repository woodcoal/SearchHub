import { ProviderError } from '../core/errors.js';
import { parseLooseDate } from '../core/date.js';
import type { ProviderRequest, RawResult, SearchProvider } from '../core/types.js';
import { clampPageSize, extractMessage, postJson, type JsonResponse } from './http.js';

const ENDPOINT = 'https://api.tavily.com/search';

/** Tavily 的 country 参数要求英文国家全名，这里做常用 ISO 码映射，未收录的忽略 */
const COUNTRY_NAMES: Record<string, string> = {
  cn: 'china',
  us: 'united states',
  gb: 'united kingdom',
  uk: 'united kingdom',
  jp: 'japan',
  kr: 'south korea',
  de: 'germany',
  fr: 'france',
  ca: 'canada',
  au: 'australia',
  in: 'india',
  sg: 'singapore',
  hk: 'hong kong',
  tw: 'taiwan',
  ru: 'russia',
  br: 'brazil',
  nl: 'netherlands',
  es: 'spain',
  it: 'italy',
  se: 'sweden',
  ch: 'switzerland',
  il: 'israel',
};

export const tavilyProvider: SearchProvider = {
  id: 'tavily',
  displayName: 'Tavily（面向 Agent 的实时搜索）',
  docsUrl: 'https://docs.tavily.com/documentation/api-reference/endpoint/search',
  capabilities: ['web', 'timeRange', 'site', 'country', 'lang', 'safeSearch'],
  // Tavily 的 /search 没有 offset 翻页参数
  supportsPaging: false,
  defaultPageSize: 10,
  maxPageSize: 20,

  async search({ query, key, signal }: ProviderRequest): Promise<RawResult[]> {
    const pageSize = clampPageSize(query.pageSize, this.defaultPageSize, this.maxPageSize);

    const body: Record<string, unknown> = {
      query: query.q,
      max_results: pageSize,
      search_depth: 'basic',
      topic: 'general',
      include_published_date: true,
      include_answer: false,
    };
    if (query.timeRange) body.time_range = query.timeRange; // day/week/month/year 与 Tavily 一致
    if (query.site) body.include_domains = [query.site];
    if (query.country) {
      const name = COUNTRY_NAMES[query.country.toLowerCase()];
      if (name) body.country = name;
    }
    if (query.lang) body.language = query.lang;
    if (query.safeSearch && query.safeSearch !== 'off') body.safe_search = true;

    const response = await postJson(ENDPOINT, {
      headers: { authorization: `Bearer ${key.value}` },
      body,
      signal,
    });

    if (response.status < 200 || response.status >= 300) throw classify(response);

    const results = Array.isArray(response.json?.results) ? response.json!.results : [];
    return results
      .filter((item: any) => typeof item?.url === 'string')
      .map((item: any): RawResult => ({
        title: typeof item.title === 'string' ? item.title : item.url,
        url: item.url,
        snippet: typeof item.content === 'string' ? item.content : '',
        publishedAt: parseLooseDate(item.published_date),
        score: typeof item.score === 'number' ? item.score : undefined,
        thumbnail: typeof item.favicon === 'string' ? item.favicon : undefined,
      }));
  },
};

function classify(response: JsonResponse): ProviderError {
  const message = extractMessage(response);
  const lower = message.toLowerCase();
  const opts = { status: response.status, retryAfterMs: response.retryAfterMs, raw: message };

  if (response.status === 401 || lower.includes('unauthorized') || lower.includes('invalid api key')) {
    return new ProviderError('keyInvalid', `Tavily 密钥无效: ${message}`, opts);
  }
  // 432 = 超出套餐额度，433 = 超出按量上限
  if (response.status === 432 || response.status === 433) {
    return new ProviderError('keyQuotaExhausted', `Tavily 配额耗尽: ${message}`, opts);
  }
  if (response.status === 429 || lower.includes('excessive requests')) {
    return new ProviderError('keyRateLimited', `Tavily 限流: ${message}`, opts);
  }
  if (response.status === 400 || response.status === 422) {
    return new ProviderError('badRequest', `Tavily 拒绝请求: ${message}`, opts);
  }
  if (response.status >= 500) {
    return new ProviderError('providerUnavailable', `Tavily 服务异常: ${message}`, opts);
  }
  return new ProviderError('providerUnavailable', `Tavily 未知响应: ${message}`, opts);
}
