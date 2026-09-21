import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { generateApiKey, hashApiKey, hashPassword, SessionTokens, verifyPassword } from '../auth.js';
import { AllProvidersFailedError } from '../core/errors.js';
import type { SearchHub } from '../core/hub.js';
import { registerMcpHttpRoutes } from '../mcp.js';
import { createApiGuard } from './guards.js';
import { createDailyLogDestination, logFileInfos, readTailLines } from '../logging.js';
import { PROVIDERS } from '../providers/index.js';
import { appVersion } from '../version.js';

const SearchQuerySchema = z.object({
  q: z.string().min(1, 'q 不能为空').max(2048),
  page: z.coerce.number().int().min(1).max(50).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
  country: z.string().max(10).optional(),
  lang: z.string().max(10).optional(),
  timeRange: z.enum(['day', 'week', 'month', 'year']).optional(),
  site: z.string().max(255).optional(),
  safeSearch: z.enum(['off', 'moderate', 'strict']).optional(),
});

const SearchBodySchema = SearchQuerySchema.extend({
  providerId: z.string().min(1).optional(),
});

/** 配额字段：null 表示继承供应商全局设置 / 不限 */
const quotaField = z.number().int().min(1).nullable().optional();
/** QPS 字段：允许小数，null 表示继承供应商全局设置 */
const qpsField = z.number().min(0.1).max(100).nullable().optional();

const ProviderPatchSchema = z.object({
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(999).optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  maxKeyAttempts: z.number().int().min(1).max(10).optional(),
  failureThreshold: z.number().int().min(1).max(100).optional(),
  cooldownMs: z.number().int().min(1000).max(3_600_000).optional(),
  defaultQps: z.number().min(0.1).max(100).optional(),
  defaultDailyQuota: quotaField,
  defaultMonthlyQuota: quotaField,
  defaultTotalQuota: quotaField,
});

const NewKeySchema = z.object({
  providerId: z.string().min(1),
  label: z.string().max(64).optional(),
  value: z.string().min(1, '密钥不能为空'),
  enabled: z.boolean().optional(),
  qps: qpsField,
  dailyQuota: quotaField,
  monthlyQuota: quotaField,
  totalQuota: quotaField,
});

const KeyPatchSchema = z.object({
  label: z.string().max(64).optional(),
  enabled: z.boolean().optional(),
  qps: qpsField,
  dailyQuota: quotaField,
  monthlyQuota: quotaField,
  totalQuota: quotaField,
  value: z.string().min(1).optional(),
});

const LoginSchema = z.object({ password: z.string().min(1, '请输入密码') });

const PasswordSchema = z.object({
  currentPassword: z.string().min(1, '请输入当前密码'),
  newPassword: z.string().min(6, '新密码至少 6 位'),
});

const DataDirSchema = z.object({ dir: z.string().min(1, '请输入目录路径') });

const NewApiKeySchema = z.object({ name: z.string().min(1, '请输入名称').max(64) });

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export async function buildServer(hub: SearchHub, config: AppConfig): Promise<FastifyInstance> {
  // 日志按天写入 <homeDir>/log/searchhub-YYYY-MM-DD.log，启动时清理过期文件
  const destination = createDailyLogDestination({
    getDir: () => config.logDir,
    retentionDays: config.logRetentionDays,
    toStdout: config.logToStdout,
  });

  const app = Fastify({
    // 日志按天切分写入文件；pino 的 stream 直接指向我们的目的地
    logger: {
      level: config.logLevel,
      stream: destination,
      redact: [
        'req.headers["x-api-key"]',
        'req.headers.authorization',
        'req.headers["x-admin-token"]',
        'body.password',
        'body.value',
        'body.secret',
      ],
    } as FastifyServerOptions['logger'],
  });

  const startedAt = new Date().toISOString();
  // 密码优先级：界面设置（settings.json） > 环境变量 > 启动时随机生成
  let passwordHash =
    config.settings.adminPasswordHash ?? hashPassword(config.adminPassword);
  const secretBase = config.secret ?? 'searchhub-dev-secret';
  // 会话密钥混入密码哈希：修改密码后所有旧令牌立即失效
  let sessions = new SessionTokens(`${secretBase}:${passwordHash}`);

  /** 管理后台登录：校验密码，签发会话令牌 */
  app.post('/api/admin/login', async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return badRequest(reply, parsed.error);
    }
    if (!verifyPassword(parsed.data.password, passwordHash)) {
      return reply.code(401).send({ error: 'unauthorized', message: '密码错误' });
    }
    return sessions.issue(config.sessionTtlMs);
  });

  /** 管理接口鉴权：会话令牌，或环境变量里的主管理令牌 */
  const adminGuard = async (request: any, reply: any) => {
    const header = request.headers['x-admin-token'] ?? request.headers.authorization ?? '';
    const provided = String(header).replace(/^Bearer\s+/i, '').trim();

    if (config.adminToken && provided === config.adminToken) return;
    if (sessions.verify(provided)) return;

    reply.code(401).send({ error: 'unauthorized', message: '未登录或登录已过期' });
  };

  /** 统一搜索接口鉴权：数据库里的 API Key，或环境变量里的主 API Key */
  const apiGuard = createApiGuard(hub, config);

  app.get('/api/health', async () => ({
    ok: true,
    time: new Date().toISOString(),
    providers: hub.health(),
  }));

  const handleSearch = async (request: any, reply: any) => {
    const parsed = SearchBodySchema.safeParse(request.body ?? request.query);
    if (!parsed.success) {
      return badRequest(reply, parsed.error);
    }
    const { providerId, ...query } = parsed.data;
    const startedAt = Date.now();

    try {
      const response = await hub.search(query, { providerId });
      // 结构化记录每次搜索，管理后台的「日志」页据此展示最近搜索情况
      request.log.info(
        {
          event: 'search',
          ok: true,
          q: query.q,
          source: request.url?.startsWith('/api/admin') ? 'admin' : 'api',
          requestedProvider: providerId ?? null,
          provider: response.meta.provider,
          keyId: response.meta.keyId,
          pageSize: query.pageSize ?? null,
          results: response.results.length,
          attempts: response.meta.attempts.length,
          degraded: response.meta.degraded,
          switchedFrom: response.meta.switchedFrom ?? null,
          tookMs: response.meta.tookMs,
        },
        '搜索完成',
      );
      return response;
    } catch (error) {
      if (error instanceof AllProvidersFailedError) {
        request.log.warn(
          {
            event: 'search',
            ok: false,
            q: query.q,
            source: request.url?.startsWith('/api/admin') ? 'admin' : 'api',
            requestedProvider: providerId ?? null,
            tookMs: Date.now() - startedAt,
            attempts: error.attempts.map((item) => ({
              provider: item.provider,
              code: item.code,
              message: item.message,
            })),
          },
          '搜索失败',
        );
      }
      return replySearchError(reply, error);
    }
  };

  app.post('/api/search', { preHandler: apiGuard }, handleSearch);
  app.get('/api/search', { preHandler: apiGuard }, handleSearch);

  // MCP over HTTP（Streamable HTTP，无状态）：远程机器 / 云端 IDE 可直接接入
  registerMcpHttpRoutes(app, hub, { name: 'searchhub', version: appVersion() }, apiGuard);

  await app.register(
    async (admin) => {
      admin.addHook('preHandler', adminGuard);

      admin.get('/state', async () => hub.state());

      /** 调用日志：每次密钥/供应商尝试的记录，持久化在 calls.jsonl，重启后保留 */
      admin.get('/calls', async (request: any) => {
        const query = (request.query ?? {}) as Record<string, string | undefined>;
        const limit = Math.min(Math.max(Number(query.limit ?? 100) || 100, 1), 1000);
        return {
          file: hub.stats.logFile ?? config.callLogFile,
          limit,
          total: hub.stats.recentLog(1000).length,
          entries: hub.stats.recentLog(limit),
        };
      });

      /** 最近搜索 / 运行日志：按天读取日志文件尾部，支持级别、关键词与「仅搜索」过滤 */
      admin.get('/logs', async (request: any) => {
        const query = (request.query ?? {}) as Record<string, string | undefined>;
        const today = new Date().toISOString().slice(0, 10);
        const date = query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : today;
        const limit = Math.min(Math.max(Number(query.limit ?? 200) || 200, 1), 1000);
        const levelFloor =
          { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 }[
            String(query.level ?? '').toLowerCase()
          ] ?? 0;
        const keyword = query.keyword?.trim().toLowerCase() ?? '';

        const file = join(config.logDir, `searchhub-${date}.log`);
        const lines = readTailLines(file);
        let entries: any[] = [];
        let skipped = 0;

        for (const line of lines) {
          try {
            entries.push(JSON.parse(line));
          } catch {
            skipped += 1;
          }
        }

        if (levelFloor > 0) entries = entries.filter((item) => Number(item.level ?? 30) >= levelFloor);
        if (query.onlySearch === 'true' || query.onlySearch === '1') {
          entries = entries.filter((item) => item.event === 'search');
        }
        if (keyword) {
          entries = entries.filter((item) => {
            const haystack = [item.q, item.msg, item.message, item.provider, item.keyId]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            return haystack.includes(keyword);
          });
        }

        entries = entries.slice(-limit).reverse();

        return {
          date,
          dir: config.logDir,
          file,
          exists: existsSync(file),
          retentionDays: config.logRetentionDays,
          files: logFileInfos(config.logDir),
          total: lines.length,
          skipped,
          entries,
        };
      });

      /** 用量统计：总计 + 24 小时/14 天趋势 + 分供应商/分密钥明细（带上密钥标签） */
      admin.get('/usage', async () => {
        const snapshot = hub.stats.usage();
        const labels = new Map<string, { label: string; hint: string; enabled: boolean }>();
        for (const provider of hub.state().providers) {
          for (const key of provider.keys) {
            labels.set(`${provider.id}:${key.id}`, {
              label: key.label,
              hint: key.hint,
              enabled: key.enabled,
            });
          }
        }

        return {
          ...snapshot,
          keys: snapshot.keys.map((item) => ({
            ...item,
            label: labels.get(`${item.providerId}:${item.keyId}`)?.label ?? '(已删除)',
            hint: labels.get(`${item.providerId}:${item.keyId}`)?.hint ?? '',
            enabled: labels.get(`${item.providerId}:${item.keyId}`)?.enabled ?? false,
          })),
        };
      });

      admin.get('/settings', async () => ({
        homeDir: config.homeDir,
        dataDir: config.dataDir,
        dataFile: config.dataFile,
        logDir: config.logDir,
        logRetentionDays: config.logRetentionDays,
        settingsFile: config.settings.path,
        passwordSource: config.settings.adminPasswordHash ? 'ui' : 'env',
        passwordUpdatedAt: config.settings.adminPasswordUpdatedAt,
        // 「关于」页需要的信息
        version: appVersion(),
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        uptimeSec: Math.floor(process.uptime()),
        startedAt: startedAt,
        providers: PROVIDERS.map((p) => ({
          id: p.id,
          displayName: p.displayName,
          docsUrl: p.docsUrl,
          capabilities: [...p.capabilities],
          supportsPaging: p.supportsPaging,
          maxPageSize: p.maxPageSize,
        })),
      }));

      admin.post('/password', async (request: any, reply: any) => {
        const parsed = PasswordSchema.safeParse(request.body);
        if (!parsed.success) {
          return badRequest(reply, parsed.error);
        }
        if (!verifyPassword(parsed.data.currentPassword, passwordHash)) {
          return reply.code(401).send({ error: 'unauthorized', message: '当前密码不正确' });
        }
        passwordHash = hashPassword(parsed.data.newPassword);
        config.settings.setAdminPassword(passwordHash);
        // 重建会话签发器，使所有旧令牌立即失效
        sessions = new SessionTokens(`${secretBase}:${passwordHash}`);
        return { ok: true, updatedAt: config.settings.adminPasswordUpdatedAt };
      });

      admin.post('/data-dir', async (request: any, reply: any) => {
        const parsed = DataDirSchema.safeParse(request.body);
        if (!parsed.success) {
          return badRequest(reply, parsed.error);
        }
        try {
          return hub.setDataDir(parsed.data.dir);
        } catch (error) {
          return reply.code(400).send({ error: 'bad_request', message: (error as Error).message });
        }
      });

      /** 管理后台调试用搜索：走同一套编排逻辑，但不需要 API Key */
      admin.post('/search', async (request: any, reply: any) =>
        handleSearch(request, reply),
      );

      admin.post('/providers/:id', async (request: any, reply: any) => {
        const { id } = request.params as { id: string };
        const parsed = ProviderPatchSchema.safeParse(request.body);
        if (!parsed.success) {
          return badRequest(reply, parsed.error);
        }
        try {
          return { provider: hub.updateProvider(id, parsed.data) };
        } catch (error) {
          return reply.code(404).send({ error: 'not_found', message: (error as Error).message });
        }
      });

      admin.post('/keys', async (request: any, reply: any) => {
        const parsed = NewKeySchema.safeParse(request.body);
        if (!parsed.success) {
          return badRequest(reply, parsed.error);
        }
        const { providerId, ...input } = parsed.data;
        try {
          const key = hub.addKey(providerId, input);
          return { key: { id: key.id, label: key.label } };
        } catch (error) {
          return reply.code(400).send({ error: 'bad_request', message: (error as Error).message });
        }
      });

      admin.patch('/keys/:providerId/:keyId', async (request: any, reply: any) => {
        const { providerId, keyId } = request.params as { providerId: string; keyId: string };
        const parsed = KeyPatchSchema.safeParse(request.body);
        if (!parsed.success) {
          return badRequest(reply, parsed.error);
        }
        const { value, ...patch } = parsed.data;
        try {
          return { key: hub.updateKey(providerId, keyId, patch, value) };
        } catch (error) {
          return reply.code(404).send({ error: 'not_found', message: (error as Error).message });
        }
      });

      admin.delete('/keys/:providerId/:keyId', async (request: any, reply: any) => {
        const { providerId, keyId } = request.params as { providerId: string; keyId: string };
        try {
          hub.removeKey(providerId, keyId);
          return { ok: true };
        } catch (error) {
          return reply.code(404).send({ error: 'not_found', message: (error as Error).message });
        }
      });

      admin.post('/keys/:providerId/:keyId/reset', async (request: any) => {
        const { providerId, keyId } = request.params as { providerId: string; keyId: string };
        hub.resetKey(providerId, keyId);
        return { ok: true };
      });

      admin.post('/keys/:providerId/:keyId/reset-usage', async (request: any) => {
        const { providerId, keyId } = request.params as { providerId: string; keyId: string };
        hub.resetKeyUsage(providerId, keyId);
        return { ok: true };
      });

      admin.post('/keys/:providerId/:keyId/test', async (request: any, reply: any) => {
        const { providerId, keyId } = request.params as { providerId: string; keyId: string };
        try {
          return await hub.testKey(providerId, keyId);
        } catch (error) {
          return reply.code(400).send({ error: 'bad_request', message: (error as Error).message });
        }
      });

      admin.get('/api-keys', async () => ({
        keys: hub.store.listApiKeys().map((key) => ({
          id: key.id,
          name: key.name,
          prefix: key.prefix,
          tail: key.tail,
          createdAt: key.createdAt,
          lastUsedAt: key.lastUsedAt,
          revoked: key.revoked,
        })),
        masterTokenConfigured: Boolean(config.apiToken),
      }));

      admin.post('/api-keys', async (request: any, reply: any) => {
        const parsed = NewApiKeySchema.safeParse(request.body);
        if (!parsed.success) {
          return badRequest(reply, parsed.error);
        }
        const generated = generateApiKey();
        const record = hub.store.addApiKey({
          name: parsed.data.name,
          hash: generated.hash,
          prefix: generated.prefix,
          tail: generated.tail,
        });
        // 明文只在创建的这一刻返回一次
        return { key: generated.key, record };
      });

      admin.post('/api-keys/:id/revoke', async (request: any, reply: any) => {
        const { id } = request.params as { id: string };
        try {
          hub.store.revokeApiKey(id);
          return { ok: true };
        } catch (error) {
          return reply.code(404).send({ error: 'not_found', message: (error as Error).message });
        }
      });

      admin.delete('/api-keys/:id', async (request: any, reply: any) => {
        const { id } = request.params as { id: string };
        try {
          hub.store.removeApiKey(id);
          return { ok: true };
        } catch (error) {
          return reply.code(404).send({ error: 'not_found', message: (error as Error).message });
        }
      });
    },
    { prefix: '/api/admin' },
  );

  // 托管管理界面构建产物。全局安装时 cwd 是任意目录，
  // 因此优先从包自身位置解析，再回退到当前目录（开发模式）。
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  // dist/server/app.js → 包根目录在两级之上；开发态（tsx 直接跑 src）同理
  const distDir =
    [
      resolve(moduleDir, '../../web/dist'),
      resolve(moduleDir, '../web/dist'),
      resolve(process.cwd(), 'web/dist'),
    ].find((dir) => existsSync(dir)) ?? resolve(moduleDir, '../../web/dist');
  app.get('/*', async (request, reply) => {
    if (!existsSync(distDir)) {
      return reply
        .code(404)
        .type('text/plain; charset=utf-8')
        .send('管理界面未构建。开发模式请运行 npm run dev:web，或执行 npm run build 生成 web/dist。');
    }
    const urlPath = (request.url.split('?')[0] ?? '/').replace(/^\/+/, '');
    const candidate = join(distDir, urlPath);
    const filePath =
      urlPath && existsSync(candidate) && extname(candidate)
        ? candidate
        : join(distDir, 'index.html');
    const body = readFileSync(filePath);
    return reply.type(MIME[extname(filePath)] ?? 'application/octet-stream').send(body);
  });

  return app;
}

/** 统一的参数校验失败响应：把第一条 issue 拼成可读 message，避免前端只看到 bad_request */
function badRequest(reply: any, error: z.ZodError): unknown {
  const message = error.issues
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join('; ');
  return reply.code(400).send({ error: 'bad_request', message, issues: error.issues });
}

function replySearchError(reply: any, error: unknown): unknown {
  if (error instanceof AllProvidersFailedError) {
    const onlyBadRequest =
      error.attempts.length > 0 && error.attempts.every((a) => a.code === 'badRequest');
    reply.log.warn({ attempts: error.attempts }, '所有供应商均失败');
    return reply.code(onlyBadRequest ? 400 : 502).send({
      error: onlyBadRequest ? 'bad_request' : 'all_providers_failed',
      message: onlyBadRequest ? '请求参数被所有供应商拒绝' : '所有搜索供应商均不可用',
      attempts: error.attempts,
    });
  }
  reply.log.error({ err: error }, '搜索请求异常');
  return reply.code(500).send({ error: 'internal_error', message: (error as Error).message });
}
