import { loadConfig } from './config.js';
import { createHub } from './runtime.js';
import { buildServer } from './server/app.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const hub = createHub(config);
  const app = await buildServer(hub, config);

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(
      { dataFile: config.dataFile, adminTokenSet: Boolean(config.adminToken) },
      `SearchHub 已启动: http://localhost:${config.port}`,
    );
    if (config.adminPasswordGenerated) {
      app.log.warn(
        `未设置 SEARCHHUB_ADMIN_PASSWORD，已生成随机管理密码: ${config.adminPassword}（重启后会变化，请在 .env 中固定）`,
      );
    }
    if (!config.apiToken) {
      app.log.warn('未设置 SEARCHHUB_API_TOKEN；请在管理界面「API 授权」中创建 API Key 后接入');
    }
  } catch (error) {
    app.log.error({ err: error }, '启动失败');
    process.exit(1);
  }
}

void main();
