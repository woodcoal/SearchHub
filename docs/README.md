# SearchHub 文档

主 [README](../README.md) 只保留定位、快速开始和最小可用信息。详细内容在这里。

| 文档 | 内容 |
|---|---|
| [quotas.md](./quotas.md) | 密钥配额：日 / 月 / 总三级配额、QPS 令牌桶、内置默认配额表、供应商级继承规则 |
| [logging.md](./logging.md) | 运行日志按天切分与保留策略、调用日志（`calls.jsonl`）、用量统计口径 |
| [data-and-settings.md](./data-and-settings.md) | 数据目录结构、系统设置、后台密码优先级与找回、数据目录迁移、认证体系 |
| [providers.md](./providers.md) | 内置供应商能力矩阵、故障分类与熔断规则、如何扩展新供应商 |
| [limitations.md](./limitations.md) | 已知限制与适用边界——**部署前请先读这一篇** |

---

## 环境变量

完整清单见仓库根目录的 [`.env.example`](../.env.example)。常用项速查：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | 服务监听地址 |
| `SEARCHHUB_HOME` | `~/.search-hub` | 根目录（数据、日志、系统设置都在它下面） |
| `SEARCHHUB_SECRET` | 空 | 供应商密钥 AES-256-GCM 加密主密钥。**强烈建议设置**，留空则明文落盘并告警 |
| `SEARCHHUB_ADMIN_PASSWORD` | 空 | 管理后台密码。留空则每次启动随机生成并打印在启动日志 |
| `SEARCHHUB_API_TOKEN` | 空 | 主 API Key，用于应急 / CI |
| `SEARCHHUB_ADMIN_TOKEN` | 空 | 主管理令牌，用于脚本免登录调用 `/api/admin/*` |
| `SEARCHHUB_LOG_RETENTION_DAYS` | `14` | 日志保留天数，`0` 表示永久保留 |
| `SEARCHHUB_LOG_STDOUT` | `true` | 是否同时输出到控制台（便于 `docker logs`） |
| `SEARCHHUB_SESSION_TTL_MS` | `28800000` | 后台登录会话有效期（8 小时） |

---

## 数据目录

未显式配置时，一切落在用户主目录下：

```text
~/.search-hub/
├── settings.json     系统设置（数据目录路径 + 后台密码哈希）
├── store.json        业务数据（供应商配置 + 密钥密文 + API Key 哈希）
└── log/
    ├── searchhub-YYYY-MM-DD.log   运行日志，按天切分
    └── calls.jsonl                调用日志，JSONL，保留最近 1000 条
```

细节见 [data-and-settings.md](./data-and-settings.md) 与 [logging.md](./logging.md)。

---

## 接口清单

| 接口 | 认证 | 说明 |
|---|---|---|
| `GET /api/health` | 公开 | 健康检查与供应商健康度（不含密钥信息） |
| `GET` / `POST /api/search` | API Key | 统一搜索接口 |
| `POST /mcp` | API Key | Streamable HTTP MCP（无状态） |
| `POST /api/admin/login` | 管理密码 | 登录，返回会话令牌 |
| `GET /api/admin/state` | 登录会话 | 供应商 / 密钥 / 统计全量状态 |
| `POST /api/admin/search` | 登录会话 | 调试台搜索，无需 API Key |
| `POST /api/admin/providers/:id` | 登录会话 | 修改供应商配置 |
| `POST` / `PATCH` / `DELETE /api/admin/keys[/...]` | 登录会话 | 供应商密钥增删改、解除冷却、连通性测试 |
| `GET` / `POST /api/admin/api-keys`、`POST /:id/revoke`、`DELETE /:id` | 登录会话 | 调用方 API Key 管理 |
| `GET /api/admin/logs` | 登录会话 | 运行日志查询 |
| `GET /api/admin/calls` | 登录会话 | 调用日志查询（`limit` 上限 1000） |
| `GET /api/admin/usage` | 登录会话 | 用量统计 |
| `GET /api/admin/settings`、`POST /api/admin/password`、`POST /api/admin/data-dir` | 登录会话 | 系统设置 |

> 所有 POST 接口都必须带 `content-type: application/json` 与请求体。
> 无请求体的 POST（如 `curl -X POST <url>`）会被 Fastify 拒绝（415 / 400），需补 `-d '{}'`。
