# SearchHub

[English README](./README.en.md) · [npm](https://www.npmjs.com/package/searchhub) · [Issues](https://github.com/woodcoal/SearchHub/issues)

> 面向 AI Agent 的自托管搜索容灾网关
>
> **One protocol. Multiple search providers. Automatic key rotation and failover.**

SearchHub 把 Serper、Tavily、Exa、AnySearch 等搜索 API 统一成一个协议，并集中处理 API Key 轮换、限流、配额、供应商故障切换和熔断。

它适合需要稳定联网搜索能力的 **MCP 客户端、AI Agent、RAG 应用和内部自动化服务**。


## 为什么用 SearchHub？

单个搜索供应商出问题时，Agent 不应该直接失明：

- 一个 Key 失效或被限流：自动换下一个 Key
- 一个供应商故障或超时：自动切换供应商
- 连续失败：熔断，冷却后半开探测
- 每个 Key 独立设置 QPS、日/月/总配额
- HTTP API、CLI、MCP 和管理后台统一提供
- 自托管，密钥和调用日志留在自己的机器上

## 30 秒启动

### npm 全局安装

要求 **Node.js >= 20**。

```bash
npm install -g searchhub
searchhub start
```

打开 <http://localhost:8787>，使用启动日志中的管理密码登录后台。

生产环境建议固定管理密码和加密密钥：

```bash
export SEARCHHUB_ADMIN_PASSWORD='change-me'
export SEARCHHUB_SECRET='replace-with-a-long-random-secret'
searchhub start
```

### npx 试用

```bash
npx searchhub start
```

### Docker Compose

```bash
curl -O https://raw.githubusercontent.com/woodcoal/SearchHub/main/docker-compose.yml
cat > .env <<'EOF'
SEARCHHUB_ADMIN_PASSWORD=change-me
SEARCHHUB_SECRET=replace-with-a-long-random-secret
# 可选：启动时自动加入供应商密钥
# SERPER_KEYS=...
# TAVILY_KEYS=...
# EXA_KEYS=...
# ANYSEARCH_KEYS=...
EOF

docker compose up -d --build
```

打开 <http://localhost:8787>。数据和日志保存在当前目录的 `data/` 中。

> 不要把 `.env` 提交到 Git。生产环境请把 `SEARCHHUB_ADMIN_PASSWORD`、`SEARCHHUB_SECRET` 和供应商密钥放进安全的 Secret 管理系统。

## 第一次配置

1. 登录管理后台。
2. 进入「供应商」或「密钥管理」，添加 Serper / Tavily / Exa / AnySearch 的 API Key。
3. 进入「API 授权」，创建一个调用方 API Key。
4. 用调试台或 CLI 发起第一次搜索。

```bash
searchhub keys add serper '<provider-key>' --label primary --qps 2
searchhub keys add tavily '<provider-key>' --label backup --monthly-quota 1000
searchhub apikey create my-agent
searchhub search "latest MCP servers" --size 5
```

供应商密钥和 SearchHub 调用方 API Key 是两套凭据：前者用于访问上游搜索服务，后者用于保护 SearchHub 接口。

## MCP 接入

### 本地 stdio

适用于 Claude Desktop、Cursor、Cline 等支持本地 MCP 的客户端：

```json
{
  "mcpServers": {
    "searchhub": {
      "command": "searchhub",
      "args": ["mcp"]
    }
  }
}
```

CLI 会从当前目录 `.env` 和环境变量读取配置。也可以指定数据目录：

```json
{
  "mcpServers": {
    "searchhub": {
      "command": "searchhub",
      "args": ["mcp", "--home", "/path/to/searchhub-data"]
    }
  }
}
```

### Streamable HTTP

主服务启动后默认提供 `/mcp`：

```json
{
  "mcpServers": {
    "searchhub": {
      "url": "http://your-host:8787/mcp",
      "headers": {
        "x-api-key": "sh_xxxxxxxxxx"
      }
    }
  }
}
```

也可以只启动 MCP HTTP 服务：

```bash
searchhub mcp --http --port 8788
```

内置工具：

| 工具 | 用途 |
|---|---|
| `searchhub_search` | 执行统一搜索 |
| `searchhub_status` | 查看供应商健康度、熔断状态和密钥数量 |
| `searchhub_providers` | 查看供应商及其能力 |

## HTTP API

健康检查无需认证：

```bash
curl http://localhost:8787/api/health
```

搜索接口使用管理后台「API 授权」生成的 Key，或 `SEARCHHUB_API_TOKEN`：

```bash
curl -X POST http://localhost:8787/api/search \
  -H 'content-type: application/json' \
  -H 'x-api-key: sh_xxxxxxxxxx' \
  -d '{"q":"MCP server","pageSize":10,"timeRange":"week","site":"github.com"}'
```

返回结果统一为：

```json
{
  "query": { "q": "MCP server", "pageSize": 10 },
  "results": [
    { "title": "...", "url": "https://...", "snippet": "...", "provider": "serper" }
  ],
  "meta": {
    "provider": "serper",
    "tookMs": 842,
    "degraded": false,
    "ignoredParams": [],
    "attempts": [{ "provider": "serper", "ok": true, "tookMs": 842 }]
  }
}
```

`meta.attempts` 会记录本次请求尝试过的 Key 和供应商，便于排障和观察降级。

接口概览：

| 接口 | 认证 | 说明 |
|---|---|---|
| `GET /api/health` | 无 | 健康检查和供应商健康度 |
| `GET/POST /api/search` | API Key | 统一搜索 |
| `POST /api/admin/login` | 管理密码 | 登录后台 |
| `/api/admin/*` | 管理会话 | 密钥、供应商、日志、用量和 API Key 管理 |
| `POST /mcp` | API Key | Streamable HTTP MCP |

## 内置供应商

| ID | 定位 | 主要能力 |
|---|---|---|
| `serper` | Google SERP 原始结果 | 翻页、时间范围、站内、地域、语言 |
| `tavily` | 面向 Agent 的实时搜索 | 时间范围、站内、地域、语言、安全搜索 |
| `exa` | 语义搜索 | 时间范围、站内 |
| `anysearch` | 统一实时搜索 | 语言、地域；支持匿名降级 |

SearchHub 会将各供应商不同的返回结构和错误码归一化。新增供应商只需实现适配器、错误分类并注册到 `src/providers/index.ts`。

## 容灾与配额

| 故障 | 处理 |
|---|---|
| Key 无效（401/403） | 隔离该 Key，切换下一个 Key |
| Key 限流（429） | 按 `Retry-After` 冷却，切换下一个 Key |
| 配额耗尽 | 冷却到下一重置周期，切换下一个 Key |
| 供应商故障（5xx/超时） | 不惩罚 Key，累计熔断计数并切换供应商 |
| 参数错误（400） | 不重复请求当前供应商，直接返回或换下一家 |

每个供应商和每把 Key 都可以设置：

- QPS
- 日配额
- 月配额
- 总配额
- 优先级和超时
- 单供应商最大换 Key 次数
- 熔断阈值和冷却时长

## CLI

```bash
searchhub start                         # 启动 API 和管理后台
searchhub search "openai" --size 5     # 直接搜索
searchhub status                        # 查看健康度
searchhub keys list                     # 列出密钥状态
searchhub keys test serper primary      # 测试某把 Key
searchhub usage --json                  # 查看用量
searchhub logs --prune                  # 清理过期日志
searchhub apikey create my-agent        # 创建调用方 API Key
searchhub mcp                           # 启动 stdio MCP
searchhub mcp --http --port 8788        # 启动 HTTP MCP
```

## 数据、日志与安全

默认目录：

```text
~/.search-hub/
├── settings.json
├── store.json
└── log/
    ├── searchhub-YYYY-MM-DD.log
    └── calls.jsonl
```

- 供应商密钥使用 `SEARCHHUB_SECRET` 进行 AES-256-GCM 加密存储；未配置时会告警。
- 管理密码只保存 scrypt 哈希。
- API Key 只保存 SHA-256 哈希，明文只在创建时显示一次。
- 日志中的 API Key、管理令牌和密钥原文会脱敏。
- `SEARCHHUB_LOG_RETENTION_DAYS` 默认保留 14 天，设为 `0` 表示永久保留。
- 运行时冷却状态、统计和用量在内存中，重启会清零；多实例部署需要 Redis 化改造。

完整环境变量见 [`.env.example`](./.env.example)。

## 从源码开发

```bash
npm install
npm run typecheck
npm run build
npm start
```

前端开发服务器：

```bash
npm run dev       # 后端
npm run dev:web   # Vite 前端，默认 http://localhost:5173
```

## Docker 部署

项目提供多阶段 `Dockerfile` 和 `docker-compose.yml`：

```bash
docker build -t searchhub:local .
docker run --rm -p 8787:8787 \
  -e SEARCHHUB_ADMIN_PASSWORD=change-me \
  -e SEARCHHUB_SECRET=replace-with-a-long-random-secret \
  -v searchhub-data:/data \
  searchhub:local
```

容器内默认：

- 监听 `0.0.0.0:8787`
- `SEARCHHUB_HOME=/data`
- 使用非 root 用户 `searchhub`
- `GET /api/health` 作为 Docker healthcheck
- `/data` 保存配置、密钥密文和日志

## 许可

MIT License。第三方搜索服务的使用仍需遵守各自的服务条款和计费规则。

Copyright (c) 2026 木炭 <woodcoal@qq.com>
