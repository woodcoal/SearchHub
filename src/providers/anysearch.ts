import { ProviderError } from '../core/errors.js';
import { parseLooseDate } from '../core/date.js';
import type { ProviderRequest, RawResult, SearchProvider } from '../core/types.js';
import { clampPageSize, extractMessage, pickResults, postJson, type JsonResponse } from './http.js';

const ENDPOINT = 'https://api.anysearch.com/v1/search';

/** AnySearch 用 zone 表达地域：cn（国内优先）/ intl（国际） */
const CN_ZONES = new Set(['cn', 'zh', 'zh-cn', 'china', 'zh_cn']);

export const anysearchProvider: SearchProvider = {
  id: 'anysearch',
  displayName: 'AnySearch（统一实时搜索）',
  docsUrl: 'https://www.anysearch.com',
  // 通用搜索不支持时间范围与站内限定；地域通过 zone 粗粒度表达
  capabilities: ['web', 'lang', 'country'],
  supportsPaging: false,
  defaultPageSize: 10,
  maxPageSize: 10, // 官方限制 max_results 1-10

  async search({ query, key, signal }: ProviderRequest): Promise<RawResult[]> {
    const pageSize = clampPageSize(query.pageSize, this.defaultPageSize, this.maxPageSize);

    const body: Record<string, unknown> = {
      query: query.q,
      max_results: pageSize,
    };
    if (query.country) {
      body.zone = CN_ZONES.has(query.country.toLowerCase()) ? 'cn' : 'intl';
    }
    if (query.lang) body.language = query.lang;

    const response = await postJson(ENDPOINT, {
      headers: { authorization: `Bearer ${key.value}` },
      body,
      signal,
    });

    // AnySearch 用 {code, message, data} 信封，业务失败也可能返回 200
    const code = response.json?.code;
    if (typeof code === 'number' && code !== 0) {
      throw classifyEnvelope(response);
    }
    if (response.status < 200 || response.status >= 300) throw classifyStatus(response);

    return pickResults(response.json)
      .filter((item: any) => typeof (item?.url ?? item?.link) === 'string')
      .map((item: any): RawResult => ({
        title: typeof item.title === 'string' ? item.title : (item.url ?? item.link),
        url: item.url ?? item.link,
        snippet:
          typeof item.content === 'string'
            ? item.content
            : typeof item.snippet === 'string'
              ? item.snippet
              : typeof item.description === 'string'
                ? item.description
                : '',
        publishedAt: parseLooseDate(item.published_date ?? item.publishedAt ?? item.date),
        score: typeof item.score === 'number' ? item.score : undefined,
      }));
  },
};

function classifyStatus(response: JsonResponse): ProviderError {
  const message = extractMessage(response);
  const lower = message.toLowerCase();
  const opts = { status: response.status, retryAfterMs: response.retryAfterMs, raw: message };

  if (response.status === 401 || response.status === 403) {
    return new ProviderError('keyInvalid', `AnySearch 密钥无效: ${message}`, opts);
  }
  if (response.status === 429) {
    return new ProviderError('keyRateLimited', `AnySearch 限流: ${message}`, opts);
  }
  if (response.status === 400 || response.status === 422) {
    return new ProviderError('badRequest', `AnySearch 拒绝请求: ${message}`, opts);
  }
  if (response.status >= 500) {
    return new ProviderError('providerUnavailable', `AnySearch 服务异常: ${message}`, opts);
  }
  return new ProviderError('providerUnavailable', `AnySearch 未知响应: ${message}`, opts);
}

function classifyEnvelope(response: JsonResponse): ProviderError {
  const message = extractMessage(response) || `code ${response.json?.code}`;
  const lower = message.toLowerCase();
  const opts = { status: response.status, raw: message };

  if (lower.includes('unauthorized') || lower.includes('api key') || lower.includes('api_key')) {
    return new ProviderError('keyInvalid', `AnySearch 密钥无效: ${message}`, opts);
  }
  if (lower.includes('quota')) {
    return new ProviderError('keyQuotaExhausted', `AnySearch 配额耗尽: ${message}`, opts);
  }
  if (lower.includes('rate limited')) {
    // 形如 "Rate limited, retry after 300 seconds."
    const matched = /retry after (\d+)/i.exec(message);
    const retryAfterMs = matched ? Number(matched[1]) * 1000 : undefined;
    return new ProviderError(
      'keyRateLimited',
      `AnySearch 限流: ${message}`,
      { ...opts, retryAfterMs },
    );
  }
  if (lower.includes('invalid') || lower.includes('missing')) {
    return new ProviderError('badRequest', `AnySearch 拒绝请求: ${message}`, opts);
  }
  return new ProviderError('providerUnavailable', `AnySearch 返回错误: ${message}`, opts);
}
