import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { SearchHub } from './core/hub.js';
import { AllProvidersFailedError } from './core/errors.js';
import { PROVIDERS } from './providers/index.js';

export interface McpOptions {
  name: string;
  version: string;
}

function formatResults(payload: {
  results: Array<{ title: string; url: string; snippet: string; publishedAt?: string; provider: string }>;
  meta: { provider: string; tookMs: number; degraded: boolean; switchedFrom?: string; ignoredParams: string[] };
}): string {
  const lines: string[] = [];
  lines.push(
    `命中供应商: ${payload.meta.provider} | 耗时: ${payload.meta.tookMs}ms | ` +
      (payload.meta.degraded ? `已降级（原 ${payload.meta.switchedFrom}）` : '未降级'),
  );
  if (payload.meta.ignoredParams.length > 0) {
    lines.push(`已忽略参数: ${payload.meta.ignoredParams.join('、')}`);
  }
  lines.push('');
  payload.results.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title}`);
    lines.push(`   ${item.url}`);
    if (item.snippet) lines.push(`   ${item.snippet}`);
    if (item.publishedAt) lines.push(`   发布时间: ${item.publishedAt}`);
  });
  return lines.join('\n');
}

export function buildMcpServer(hub: SearchHub, options: McpOptions): McpServer {
  const server = new McpServer({ name: options.name, version: options.version });

  server.registerTool(
    'searchhub_search',
    {
      title: '统一网络搜索',
      description:
        '通过 SearchHub 聚合网关执行网络搜索，自动在多家供应商（Serper/Tavily/Exa/AnySearch）之间轮换密钥与容灾切换。返回标题、链接、摘要等结构化结果。',
      inputSchema: {
        q: z.string().min(1).describe('检索词'),
        pageSize: z.number().int().min(1).max(50).optional().describe('返回条数，默认 10'),
        page: z.number().int().min(1).optional().describe('页码，从 1 开始（部分供应商不支持翻页）'),
        providerId: z
          .enum(['serper', 'tavily', 'exa', 'anysearch'])
          .optional()
          .describe('强制指定供应商，留空按优先级自动选择'),
        timeRange: z.enum(['day', 'week', 'month', 'year']).optional().describe('时间范围'),
        site: z.string().optional().describe('站内限定，如 github.com'),
        country: z.string().optional().describe('国家/地区 ISO 码，如 us、cn'),
        lang: z.string().optional().describe('语言，如 en、zh'),
      },
    },
    async (args) => {
      try {
        const response = await hub.search({
          q: args.q,
          pageSize: args.pageSize,
          page: args.page,
          timeRange: args.timeRange,
          site: args.site,
          country: args.country,
          lang: args.lang,
        }, { providerId: args.providerId });

        return {
          content: [
            {
              type: 'text' as const,
              text: formatResults({ results: response.results, meta: response.meta }),
            },
          ],
          structuredContent: {
            results: response.results,
            meta: response.meta,
          },
        };
      } catch (error) {
        if (error instanceof AllProvidersFailedError) {
          const detail = error.attempts
            .map((a) => `${a.provider}: ${a.code ?? '失败'} ${a.message ?? ''}`)
            .join('; ');
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `所有搜索供应商均不可用（${detail}）` }],
          };
        }
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `搜索失败: ${(error as Error).message}` }],
        };
      }
    },
  );

  server.registerTool(
    'searchhub_status',
    {
      title: '网关健康状态',
      description: '查看各搜索供应商的启用状态、熔断状态、可用/冷却/隔离的密钥数量与调用统计。',
      inputSchema: {},
    },
    async () => {
      const health = hub.health();
      const text = health
        .map(
          (item) =>
            `${item.id}: ${item.enabled ? '启用' : '停用'} | 熔断=${item.breaker.state} | ` +
            `可用密钥=${item.keySummary.active} 冷却=${item.keySummary.cooling} 隔离=${item.keySummary.quarantined} | ` +
            `调用=${item.stats.calls} 失败=${item.stats.failed}`,
        )
        .join('\n');
      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: { providers: health },
      };
    },
  );

  server.registerTool(
    'searchhub_providers',
    {
      title: '供应商能力清单',
      description: '列出内置供应商及其支持的能力（时间范围、站内限定、地域、语言、翻页等）。',
      inputSchema: {},
    },
    async () => {
      const text = PROVIDERS.map(
        (p) =>
          `${p.id}（${p.displayName}）: 能力=${p.capabilities.join('/')} | ` +
          `翻页=${p.supportsPaging ? '支持' : '不支持'} | 每页上限=${p.maxPageSize}`,
      ).join('\n');
      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: {
          providers: PROVIDERS.map((p) => ({
            id: p.id,
            displayName: p.displayName,
            capabilities: p.capabilities,
            supportsPaging: p.supportsPaging,
            maxPageSize: p.maxPageSize,
          })),
        },
      };
    },
  );

  return server;
}

/** 以 stdio 传输启动 MCP 服务（供 Claude Desktop / Cursor 等客户端接入） */
export async function startMcpStdio(hub: SearchHub, options: McpOptions): Promise<void> {
  const server = buildMcpServer(hub, options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // 注意：stdio 传输下任何 stdout 输出都会破坏协议，日志必须走 stderr
  console.error(`[searchhub] MCP 服务已就绪（stdio），已注册 searchhub_search / searchhub_status / searchhub_providers`);
}
