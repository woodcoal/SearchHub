import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { generateApiKey, hashApiKey, hashPassword, SessionTokens, verifyPassword } from '../auth.js';
import { AllProvidersFailedError } from '../core/errors.js';
import type { SearchHub } from '../core/hub.js';

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

const ProviderPatchSchema = z.object({
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(999).optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  maxKeyAttempts: z.number().int().min(1).max(10).optional(),
  failureThreshold: z.number().int().min(1).max(100).optional(),
  cooldownMs: z.number().int().min(1000).max(3_600_000).optional(),
});

const NewKeySchema = z.object({
  providerId: z.string().min(1),
  label: z.string().max(64).optional(),
  value: z.string().min(1, '密钥不能为空'),
  enabled: z.boolean().optional(),
  qps: z.number().min(0.1).max(100).optional(),
  dailyQuota: z.number().int().min(1).nullable().optional(),
});

const KeyPatchSchema = z.object({
  label: z.string().max(64).optional(),
  enabled: z.boolean().optional(),
  qps: z.number().min(0.1).max(100).optional(),
  dailyQuota: z.number().int().min(1).nullable().optional(),
  value: z.string().min(1).optional(),
});

const LoginSchema = z.object({ password: z.string().min(1, '请输入密码') });

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
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: [
        'req.headers["x-api-key"]',
        'req.headers.authorization',
        'req.headers["x-admin-token"]',
        'body.password',
        'body.value',
        'body.secret',
      ],
    },
  });

  const passwordHash = hashPassword(config.adminPassword);
  // 会话密钥混入密码哈希：修改密码后所有旧令牌立即失效
  const sessions = new SessionTokens(`${config.secret ?? 'searchhub-dev-secret'}:${passwordHash}`);

  /** 管理后台登录：校验密码，签发会话令牌 */
  app.post('/api/admin/login', async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
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
  const apiGuard = async (request: any, reply: any) => {
    const header = request.headers['x-api-key'] ?? request.headers.authorization ?? '';
    const provided = String(header).replace(/^Bearer\s+/i, '').trim();

    if (!provided) {
      return reply
        .code(401)
        .send({ error: 'unauthorized', message: '缺少 x-api-key 请求头' });
    }
    if (config.apiToken && provided === config.apiToken) return;

    const record = hub.store.findApiKeyByHash(hashApiKey(provided));
    if (!record) {
      return reply
        .code(401)
        .send({ error: 'unauthorized', message: 'API Key 无效或已吊销' });
    }
    hub.store.touchApiKey(record.id);
  };

  app.get('/api/health', async () => ({
    ok: true,
    time: new Date().toISOString(),
    providers: hub.health(),
  }));

  const handleSearch = async (request: any, reply: any) => {
    const parsed = SearchBodySchema.safeParse(request.body ?? request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    }
    const { providerId, ...query } = parsed.data;
    try {
      return await hub.search(query, { providerId });
    } catch (error) {
      return replySearchError(reply, error);
    }
  };

  app.post('/api/search', { preHandler: apiGuard }, handleSearch);
  app.get('/api/search', { preHandler: apiGuard }, handleSearch);

  await app.register(
    async (admin) => {
      admin.addHook('preHandler', adminGuard);

      admin.get('/state', async () => hub.state());

      /** 管理后台调试用搜索：走同一套编排逻辑，但不需要 API Key */
      admin.post('/search', async (request: any, reply: any) =>
        handleSearch(request, reply),
      );

      admin.post('/providers/:id', async (request: any, reply: any) => {
        const { id } = request.params as { id: string };
        const parsed = ProviderPatchSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
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
          return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
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
          return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
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
          return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
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

  // 生产模式下托管管理界面构建产物
  const distDir = resolve(process.cwd(), 'web/dist');
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
