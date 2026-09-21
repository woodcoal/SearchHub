import { ProviderError } from '../core/errors.js';
import { parseLooseDate } from '../core/date.js';
import type { ProviderRequest, RawResult, SearchProvider, TimeRange } from '../core/types.js';
import { clampPageSize, extractMessage, postJson, type JsonResponse } from './http.js';

const ENDPOINT = 'https://api.exa.ai/search';

const RANGE_MS: Record<TimeRange, number> = {
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
};

export const exaProvider: SearchProvider = {
  id: 'exa',
  displayName: 'Exa（神经/语义搜索）',
  docsUrl: 'https://docs.exa.ai/reference/search',
  // Exa 的 /search 不支持 offset 翻页；地域/语言也不在其请求模型内
  capabilities: ['web', 'timeRange', 'site'],
  supportsPaging: false,
  defaultPageSize: 10,
  maxPageSize: 50,

  async search({ query, key, signal }: ProviderRequest): Promise<RawResult[]> {
    const pageSize = clampPageSize(query.pageSize, this.defaultPageSize, this.maxPageSize);

    const body: Record<string, unknown> = {
      query: query.q,
      numResults: pageSize,
      useAutoprompt: true,
      contents: { text: { maxCharacters: 400 } },
    };
    if (query.site) body.includeDomains = [query.site];
    if (query.timeRange) {
      body.startPublishedDate = new Date(Date.now() - RANGE_MS[query.timeRange]).toISOString();
    }

    const response = await postJson(ENDPOINT, {
      headers: { 'x-api-key': key.value },
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
        snippet: typeof item.text === 'string' ? item.text : '',
        publishedAt: parseLooseDate(item.publishedDate),
        score: typeof item.score === 'number' ? item.score : undefined,
        thumbnail: typeof item.image === 'string' ? item.image : undefined,
      }));
  },
};

function classify(response: JsonResponse): ProviderError {
  const message = extractMessage(response);
  const lower = message.toLowerCase();
  const opts = { status: response.status, retryAfterMs: response.retryAfterMs, raw: message };

  if (lower.includes('api key') || lower.includes('unauthorized') || response.status === 401) {
    return new ProviderError('keyInvalid', `Exa 密钥无效: ${message}`, opts);
  }
  if (response.status === 402 || lower.includes('quota') || lower.includes('insufficient')) {
    return new ProviderError('keyQuotaExhausted', `Exa 配额耗尽: ${message}`, opts);
  }
  if (response.status === 403) {
    return new ProviderError('keyInvalid', `Exa 拒绝访问: ${message}`, opts);
  }
  if (response.status === 429) {
    return new ProviderError('keyRateLimited', `Exa 限流: ${message}`, opts);
  }
  if (response.status === 400) {
    return new ProviderError('badRequest', `Exa 拒绝请求: ${message}`, opts);
  }
  if (response.status >= 500) {
    return new ProviderError('providerUnavailable', `Exa 服务异常: ${message}`, opts);
  }
  return new ProviderError('providerUnavailable', `Exa 未知响应: ${message}`, opts);
}
