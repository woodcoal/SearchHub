# SearchHub 接口参考

## 基础信息

| 项目 | 值 |
|---|---|
| 默认地址 | `http://127.0.0.1:8787` |
| 搜索接口 | `POST /api/search`（也支持 `GET /api/search?q=...`） |
| 健康检查 | `GET /api/health`（公开，不含密钥） |
| MCP 端点 | `POST /mcp`（Streamable HTTP，无状态） |
| 鉴权 | `x-api-key: sh_xxx` 或 `Authorization: Bearer sh_xxx` |

所有 POST 请求都必须带 `content-type: application/json` 与请求体（无参数时传 `{}`）。

## POST /api/search

请求体字段见 SKILL.md；响应：

| 字段 | 说明 |
|---|---|
| `results[]` | 统一结果：`title`、`url`、`snippet`、`publishedAt?`、`score?`、`provider` |
| `meta.provider` | 实际命中的供应商 |
| `meta.keyId` | 实际使用的网关密钥（脱敏前缀） |
| `meta.tookMs` | 网关侧耗时 |
| `meta.degraded` | 是否发生降级；`switchedFrom` 为原本尝试的供应商 |
| `meta.ignoredParams` | 该供应商不支持、被忽略的参数 |
| `meta.attempts[]` | 完整尝试链路：试过哪些密钥/供应商、成功与否、耗时 |

## GET /api/health

```json
{
  "ok": true,
  "providers": [
    {
      "id": "serper",
      "enabled": true,
      "breaker": { "state": "closed", "failures": 0 },
      "keySummary": { "total": 2, "active": 2, "cooling": 0, "quarantined": 0 },
      "stats": { "calls": 12, "success": 12, "failed": 0 }
    }
  ]
}
```

## 错误码

| HTTP | error | 含义与处理 |
|---|---|---|
| 400 | `bad_request` | 参数校验失败（`message` 会指出具体字段） |
| 401 | `unauthorized` | 缺少 / 无效 / 已吊销的 API Key |
| 404 | `not_found` | 供应商或密钥不存在 |
| 502 | `all_providers_failed` | 所有供应商不可用，看 `attempts` 定位原因 |
| 500 | `internal_error` | 网关内部异常 |

`attempts[].code` 故障分类：

| code | 触发 | 网关动作 |
|---|---|---|
| `keyInvalid` | 401/403 | 隔离该密钥并换下一把 |
| `keyRateLimited` | 429 | 按 `Retry-After` 冷却后换密钥 |
| `keyQuotaExhausted` | 配额耗尽 | 冷却到次日或次月重置点 |
| `providerUnavailable` | 5xx / 超时 | 不惩罚密钥，计入熔断并切换供应商 |
| `badRequest` | 400 | 重试无意义，切换下一家供应商 |
| `no_key_available` | 密钥全部不可用 | 该供应商暂时不可用 |
| `circuit_open` | 熔断中 | 跳过该供应商 |

## MCP 接入

stdio（本地客户端）：

```json
{ "mcpServers": { "searchhub": { "command": "searchhub", "args": ["mcp"] } } }
```

Streamable HTTP（远程）：

```json
{
  "mcpServers": {
    "searchhub": {
      "url": "http://your-host:8787/mcp",
      "headers": { "x-api-key": "sh_xxxxxxxxxx" }
    }
  }
}
```

MCP 工具：

| 工具 | 说明 |
|---|---|
| `searchhub_search` | 执行搜索（参数与 `/api/search` 一致） |
| `searchhub_status` | 各供应商熔断状态、密钥可用数与调用统计 |
| `searchhub_providers` | 内置供应商及其能力清单 |

## 供应商能力差异

| 供应商 | 定位 | 时间范围 | 站内限定 | 地域 | 翻页 | 每页上限 |
|---|---|---|---|---|---|---|
| `serper` | Google SERP | ✔ | ✔ | ✔ | ✔ | 50 |
| `tavily` | 面向 Agent 的实时搜索 | ✔ | ✔ | ✔ | ✘ | 20 |
| `exa` | 神经（语义）搜索 | ✔ | ✔ | ✘ | ✘ | 50 |
| `anysearch` | 统一实时搜索 | ✘ | ✘ | 粗粒度 zone | ✘ | 10 |

不支持的参数会被静默忽略并记入 `meta.ignoredParams`。
