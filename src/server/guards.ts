import type { FastifyReply, FastifyRequest } from 'fastify';
import { hashApiKey } from '../auth.js';
import type { AppConfig } from '../config.js';
import type { SearchHub } from '../core/hub.js';

/**
 * 统一搜索接口的鉴权：数据库里的 API Key，或环境变量里的主 API Key。
 * HTTP 形式的 MCP 服务复用同一套鉴权，避免多一份实现。
 */
export function createApiGuard(hub: SearchHub, config: AppConfig) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const header = request.headers['x-api-key'] ?? request.headers.authorization ?? '';
    const provided = String(header).replace(/^Bearer\s+/i, '').trim();

    if (!provided) {
      return reply.code(401).send({ error: 'unauthorized', message: '缺少 x-api-key 请求头' });
    }
    if (config.apiToken && provided === config.apiToken) return;

    const record = hub.store.findApiKeyByHash(hashApiKey(provided));
    if (!record) {
      return reply.code(401).send({ error: 'unauthorized', message: 'API Key 无效或已吊销' });
    }
    hub.store.touchApiKey(record.id);
  };
}
