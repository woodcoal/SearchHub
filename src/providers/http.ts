export interface JsonResponse {
  status: number;
  json: Record<string, any> | undefined;
  text: string;
  retryAfterMs?: number;
  rateLimitRemaining?: string | null;
}

/**
 * 统一的 JSON POST。刻意不抛 HTTP 错误 —— 错误分类交给各适配器，
 * 因为「429 到底是限流还是配额耗尽」只有各家自己说得清。
 */
export async function postJson(
  url: string,
  options: { headers: Record<string, string>; body: unknown; signal: AbortSignal },
): Promise<JsonResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...options.headers },
    body: JSON.stringify(options.body),
    signal: options.signal,
  });

  const text = await response.text();
  let json: Record<string, any> | undefined;
  try {
    json = text ? (JSON.parse(text) as Record<string, any>) : undefined;
  } catch {
    json = undefined;
  }

  return {
    status: response.status,
    json,
    text,
    retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
    rateLimitRemaining: response.headers.get('x-ratelimit-remaining'),
  };
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return Math.max(1000, seconds * 1000);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(1000, date - Date.now());
}

export function clampPageSize(requested: number | undefined, fallback: number, max: number): number {
  const value = requested ?? fallback;
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}

/** 提取各家不一致的错误描述（Tavily 用 detail.error、AnySearch 用 message） */
export function extractMessage(response: JsonResponse): string {
  const json = response.json;
  const candidate =
    json?.message ??
    json?.error ??
    json?.detail?.error ??
    json?.detail ??
    json?.msg;
  if (typeof candidate === 'string') return candidate;
  if (candidate && typeof candidate === 'object' && typeof candidate.message === 'string') {
    return candidate.message;
  }
  return response.text.slice(0, 200) || `HTTP ${response.status}`;
}

/** 各家返回结构五花八门，按顺序尝试常见的结果字段 */
export function pickResults(json: Record<string, any> | undefined): any[] {
  if (!json) return [];
  const candidates = [
    json.results,
    json.data?.results,
    json.data?.items,
    json.data?.list,
    json.data,
    json.items,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}
