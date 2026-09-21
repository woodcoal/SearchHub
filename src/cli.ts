#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateApiKey } from './auth.js';
import { loadConfig } from './config.js';
import { createHub } from './runtime.js';
import { buildServer } from './server/app.js';

const COLOR = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function paint(color: string, text: string): string {
  return process.stdout.isTTY ? `${color}${text}${COLOR.reset}` : text;
}

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq > -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[body] = next;
      i += 1;
    } else {
      flags[body] = true;
    }
  }

  return { positional, flags };
}

/** 轻量 .env 支持，避免为一个 CLI 引入 dotenv 依赖 */
function loadDotEnv(cwd = process.cwd()): void {
  const file = resolve(cwd, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function envWithFlags(flags: Record<string, string | boolean>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (typeof flags.port === 'string') env.PORT = flags.port;
  if (typeof flags.host === 'string') env.HOST = flags.host;
  if (typeof flags.data === 'string') env.DATA_FILE = flags.data;
  return env;
}

function printHelp(): void {
  console.log(`
${paint(COLOR.bold, 'SearchHub CLI')} — 统一搜索网关

${paint(COLOR.cyan, '用法')}
  searchhub <命令> [参数] [选项]

${paint(COLOR.cyan, '命令')}
  start                       启动服务（默认命令，同时提供 API 与管理界面）
  search <关键词>              直接调用统一搜索接口（不走 HTTP）
  status                      查看各供应商健康度与密钥状态
  keys list                   列出所有供应商密钥
  keys add <供应商> <密钥>      添加供应商密钥
  keys test <供应商> <id|标签>  测试单个密钥连通性
  keys remove <供应商> <id|标签> 删除供应商密钥
  apikey create <名称>         创建接入用的 API Key（明文只显示一次）
  apikey list                 列出 API Key
  apikey revoke <id>          吊销 API Key
  help                        显示帮助

${paint(COLOR.cyan, '选项')}
  --port <端口>               服务端口，默认 8787
  --host <地址>               监听地址，默认 0.0.0.0
  --data <路径>               数据文件路径，默认 ./data/store.json
  --provider <serper|exa>     指定供应商
  --size <条数>               返回条数，默认 10
  --json                      以 JSON 输出

${paint(COLOR.cyan, '示例')}
  searchhub start --port 9000
  searchhub search "openai" --size 5
  searchhub keys add serper xxxxxxxx --label 主key --qps 2
  searchhub apikey create 生产环境
`);
}

async function start(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const config = loadConfig(envWithFlags(flags));
  const hub = createHub(config);
  const app = await buildServer(hub, config);

  await app.listen({ port: config.port, host: config.host });

  if (config.adminPasswordGenerated) {
    console.warn(
      paint(
        COLOR.yellow,
        `未设置 SEARCHHUB_ADMIN_PASSWORD，本次随机管理密码：${config.adminPassword}`,
      ),
    );
  }
  console.log(paint(COLOR.green, `SearchHub 已启动: http://localhost:${config.port}`));
  console.log(`${paint(COLOR.dim, '数据文件:')} ${config.dataFile}`);
}

async function search(argv: string[]): Promise<void> {
  const { positional, flags } = parseArgs(argv);
  const q = positional.join(' ');
  if (!q) {
    console.error(paint(COLOR.red, '请提供检索词：searchhub search "关键词"'));
    process.exit(1);
  }

  const hub = createHub(loadConfig(envWithFlags(flags)));
  const response = await hub.search(
    {
      q,
      pageSize: typeof flags.size === 'string' ? Number(flags.size) : 10,
      country: typeof flags.country === 'string' ? flags.country : undefined,
      lang: typeof flags.lang === 'string' ? flags.lang : undefined,
      timeRange: typeof flags.timeRange === 'string' ? (flags.timeRange as never) : undefined,
      site: typeof flags.site === 'string' ? flags.site : undefined,
    },
    { providerId: typeof flags.provider === 'string' ? flags.provider : undefined },
  );

  if (flags.json) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  const { meta } = response;
  console.log(
    `${paint(COLOR.dim, '命中供应商:')} ${meta.provider}  ` +
      `${paint(COLOR.dim, '耗时:')} ${meta.tookMs}ms  ` +
      `${meta.degraded ? paint(COLOR.yellow, `已降级(原 ${meta.switchedFrom})`) : paint(COLOR.green, '未降级')}`,
  );
  if (meta.ignoredParams.length > 0) {
    console.log(paint(COLOR.yellow, `已忽略参数: ${meta.ignoredParams.join('、')}`));
  }
  console.log('');

  response.results.forEach((item, index) => {
    console.log(`${paint(COLOR.cyan, `${index + 1}. ${item.title}`)}`);
    console.log(`   ${paint(COLOR.dim, item.url)}`);
    if (item.snippet) console.log(`   ${item.snippet.slice(0, 160)}`);
  });
}

async function status(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const hub = createHub(loadConfig(envWithFlags(flags)));

  if (flags.json) {
    console.log(JSON.stringify(hub.health(), null, 2));
    return;
  }

  const rows = hub.health().map((item) => ({
    供应商: item.id,
    状态: item.enabled ? '启用' : '停用',
    熔断: item.breaker.state,
    可用密钥: item.keySummary.active,
    冷却: item.keySummary.cooling,
    隔离: item.keySummary.quarantined,
    调用: item.stats.calls,
    失败: item.stats.failed,
  }));
  console.table(rows);
}

async function keys(argv: string[]): Promise<void> {
  const { positional, flags } = parseArgs(argv);
  const [action, providerId, ref] = positional;
  const hub = createHub(loadConfig(envWithFlags(flags)));
  const state = hub.state();

  if (!action || action === 'list') {
    for (const provider of state.providers) {
      console.log(paint(COLOR.bold, `\n${provider.displayName} (${provider.id})`));
      if (provider.keys.length === 0) {
        console.log('  ' + paint(COLOR.dim, '暂无密钥'));
        continue;
      }
      console.table(
        provider.keys.map((key) => ({
          id: key.id.slice(0, 8),
          标签: key.label,
          状态: key.enabled ? key.state : '已禁用',
          今日用量: key.dailyQuota ? `${key.usedToday}/${key.dailyQuota}` : key.usedToday,
          QPS: key.qps,
          最近错误: key.lastError ?? '-',
        })),
      );
    }
    return;
  }

  if (!providerId) {
    console.error(paint(COLOR.red, '缺少供应商参数'));
    process.exit(1);
  }

  if (action === 'add') {
    if (!ref) {
      console.error(paint(COLOR.red, '用法: searchhub keys add <供应商> <密钥> [--label 名称]'));
      process.exit(1);
    }
    const key = hub.addKey(providerId, {
      label: typeof flags.label === 'string' ? flags.label : undefined,
      value: ref,
      qps: typeof flags.qps === 'string' ? Number(flags.qps) : 1,
      dailyQuota: typeof flags.quota === 'string' ? Number(flags.quota) : null,
    });
    console.log(paint(COLOR.green, `已添加密钥 ${key.label} (${key.id})`));
    return;
  }

  const provider = state.providers.find((p) => p.id === providerId);
  const key = provider?.keys.find((k) => k.id === ref || k.label === ref);
  if (!key) {
    console.error(paint(COLOR.red, `未找到密钥: ${ref}`));
    process.exit(1);
  }

  if (action === 'test') {
    const result = await hub.testKey(providerId, key.id);
    console.log(
      result.ok
        ? paint(COLOR.green, `${key.label}: ${result.message}`)
        : paint(COLOR.red, `${key.label}: ${result.message}`),
    );
    return;
  }

  if (action === 'remove') {
    hub.removeKey(providerId, key.id);
    console.log(paint(COLOR.green, `已删除密钥 ${key.label}`));
    return;
  }

  console.error(paint(COLOR.red, `未知操作: ${action}`));
  process.exit(1);
}

async function apikey(argv: string[]): Promise<void> {
  const { positional, flags } = parseArgs(argv);
  const [action, arg] = positional;
  const hub = createHub(loadConfig(envWithFlags(flags)));

  if (action === 'create') {
    if (!arg) {
      console.error(paint(COLOR.red, '用法: searchhub apikey create <名称>'));
      process.exit(1);
    }
    const generated = generateApiKey();
    const record = hub.store.addApiKey({
      name: arg,
      hash: generated.hash,
      prefix: generated.prefix,
      tail: generated.tail,
    });
    console.log(paint(COLOR.green, '创建成功，请立即保存（只显示这一次）：'));
    console.log(paint(COLOR.cyan, generated.key));
    console.log(`${paint(COLOR.dim, 'id:')} ${record.id}`);
    return;
  }

  if (!action || action === 'list') {
    const list = hub.store.listApiKeys();
    if (list.length === 0) {
      console.log(paint(COLOR.dim, '尚未创建 API Key'));
      return;
    }
    console.table(
      list.map((key) => ({
        id: key.id.slice(0, 8),
        名称: key.name,
        Key: `${key.prefix}…${key.tail}`,
        状态: key.revoked ? '已吊销' : '有效',
        创建时间: new Date(key.createdAt).toLocaleString(),
        最近使用: key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : '从未使用',
      })),
    );
    return;
  }

  if (action === 'revoke') {
    if (!arg) {
      console.error(paint(COLOR.red, '用法: searchhub apikey revoke <id>'));
      process.exit(1);
    }
    const target = hub.store
      .listApiKeys()
      .find((k) => k.id === arg || k.id.startsWith(arg));
    if (!target) {
      console.error(paint(COLOR.red, `未找到 API Key: ${arg}`));
      process.exit(1);
    }
    hub.store.revokeApiKey(target.id);
    console.log(paint(COLOR.green, `已吊销 ${target.name}`));
    return;
  }

  console.error(paint(COLOR.red, `未知操作: ${action ?? ''}`));
  process.exit(1);
}

async function main(): Promise<void> {
  loadDotEnv();
  const [command = 'start', ...rest] = process.argv.slice(2);

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    case 'version':
    case '--version':
    case '-v':
      console.log('0.1.0');
      return;
    case 'start':
      await start(rest);
      return;
    case 'search':
      await search(rest);
      return;
    case 'status':
      await status(rest);
      return;
    case 'keys':
      await keys(rest);
      return;
    case 'apikey':
      await apikey(rest);
      return;
    default:
      console.error(paint(COLOR.red, `未知命令: ${command}`));
      printHelp();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(paint(COLOR.red, (error as Error).message));
  process.exit(1);
});
