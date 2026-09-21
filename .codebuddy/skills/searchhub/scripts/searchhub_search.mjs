#!/usr/bin/env node
/**
 * SearchHub 搜索脚本（零依赖，Node 18+）
 *
 *   node searchhub_search.mjs "关键词" [--size 10] [--provider exa]
 *        [--page 1] [--time-range week] [--site github.com] [--country cn] [--lang zh]
 *        [--base http://127.0.0.1:8787] [--api-key sh_xxx] [--json]
 *   node searchhub_search.mjs --status
 *
 * 环境变量：SEARCHHUB_BASE_URL、SEARCHHUB_API_KEY
 */

const args = process.argv.slice(2);

function take(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  args.splice(index, value && !value.startsWith('--') ? 2 : 1);
  return value && !value.startsWith('--') ? value : true;
}

const status = Boolean(take('--status'));
const json = Boolean(take('--json'));
const base = String(take('--base') ?? process.env.SEARCHHUB_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const apiKey = take('--api-key') ?? process.env.SEARCHHUB_API_KEY;
const size = Number(take('--size') ?? 10);
const page = Number(take('--page') ?? 1);
const provider = take('--provider');
const timeRange = take('--time-range');
const site = take('--site');
const country = take('--country');
const lang = take('--lang');
const query = args.filter((arg) => !arg.startsWith('--')).join(' ').trim();

function fail(message, detail) {
  console.error(`SearchHub 调用失败：${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

async function call(path, options = {}) {
  const headers = { 'content-type': 'application/json' };
  if (apiKey && typeof apiKey === 'string') headers['x-api-key'] = apiKey;
  let response;
  try {
    response = await fetch(`${base}${path}`, { ...options, headers });
  } catch (error) {
    fail(`无法连接网关 ${base}`, error.message);
  }
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message = body?.message ?? body?.error ?? `HTTP ${response.status}`;
    const attempts = Array.isArray(body?.attempts)
      ? `\n尝试链路：\n${body.attempts
          .map((item) => `  - ${item.provider}: ${item.code ?? 'ok'} ${item.message ?? ''}`)
          .join('\n')}`
      : '';
    fail(message, attempts);
  }
  return body;
}

if (status) {
  const health = await call('/api/health');
  console.log(`网关 ${base} 状态：${health.ok ? '正常' : '异常'}`);
  for (const item of health.providers ?? []) {
    const keys = item.keySummary ?? {};
    console.log(
      `  ${item.id}: ${item.enabled ? '启用' : '停用'} | 熔断=${item.breaker?.state ?? 'unknown'} | ` +
        `可用密钥=${keys.active ?? 0} 冷却=${keys.cooling ?? 0} 隔离=${keys.quarantined ?? 0}`,
    );
  }
  process.exit(0);
}

if (!query) {
  console.error('用法：node searchhub_search.mjs "关键词" [--size 10] [--provider exa] [--json]');
  console.error('      node searchhub_search.mjs --status');
  process.exit(1);
}

const body = { q: query, pageSize: Number.isFinite(size) ? size : 10 };
if (Number.isFinite(page) && page > 1) body.page = page;
if (typeof provider === 'string') body.providerId = provider;
if (typeof timeRange === 'string') body.timeRange = timeRange;
if (typeof site === 'string') body.site = site;
if (typeof country === 'string') body.country = country;
if (typeof lang === 'string') body.lang = lang;

const result = await call('/api/search', { method: 'POST', body: JSON.stringify(body) });

if (json) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const meta = result.meta ?? {};
console.log(
  `命中供应商: ${meta.provider} | 耗时: ${meta.tookMs}ms | ${meta.degraded ? `已降级（原 ${meta.switchedFrom}）` : '未降级'}`,
);
if (Array.isArray(meta.ignoredParams) && meta.ignoredParams.length > 0) {
  console.log(`已忽略参数: ${meta.ignoredParams.join('、')}`);
}
console.log('');
for (const [index, item] of (result.results ?? []).entries()) {
  console.log(`${index + 1}. ${item.title}`);
  console.log(`   ${item.url}`);
  if (item.snippet) console.log(`   ${item.snippet}`);
  if (item.publishedAt) console.log(`   发布时间: ${item.publishedAt}`);
}
if ((result.results ?? []).length === 0) console.log('（没有检索到结果，可放宽条件后重试）');
