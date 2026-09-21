# 供应商、故障分类与扩展

## 内置供应商

| ID | 定位 | 鉴权头 | 能力 | 翻页 |
|---|---|---|---|---|
| `serper` | Google SERP 原始结果 | `X-API-KEY` | web / 时间范围 / 站内 / 地域 / 语言 | **支持** |
| `tavily` | 面向 Agent 的实时搜索 | `Authorization: Bearer tvly-…` | web / 时间范围 / 站内 / 地域 / 语言 / 安全搜索 | 不支持 |
| `exa` | 神经（语义）搜索 | `x-api-key` | web / 时间范围 / 站内 | 不支持 |
| `anysearch` | 统一实时搜索（支持匿名降级） | `Authorization: Bearer as_sk_…` | web / 语言 / 地域（zone） | 不支持 |

各家的返回结构差异由适配器归一化为统一的 `SearchResult`；**错误码也统一翻译为内部故障分类**。因此"这个 429 到底是限流还是配额耗尽""432/433 是套餐超限"这类差异，调用方完全不需要关心。

请求里传了某家不支持的参数时，不会静默丢弃——会被记录到响应的 `meta.ignoredParams` 里。

---

## 故障分类与容灾规则

失败不是无脑重试，而是先分类再决定动作：

| 故障类型 | 判定 | 系统动作 |
|---|---|---|
| `keyInvalid` | 401 / 403，密钥无效 | 该 key **隔离 6 小时**，立即换下一个 key |
| `keyRateLimited` | 429，被限流 | 按 `Retry-After` 冷却（缺省 60s），换下一个 key |
| `keyQuotaExhausted` | 402 / 额度提示，配额耗尽 | 冷却到**次日 UTC 0 点**，换下一个 key |
| `providerUnavailable` | 5xx / 超时，供应商故障 | **不惩罚 key**，计入熔断计数，切换供应商 |
| `badRequest` | 400，请求本身有问题 | 不重试该供应商，直接换下一家 |
| 全部失败 | — | 返回 502 + 完整 `attempts`；若全是 400 则返回 400 |

### 熔断器

状态机：连续失败达阈值 → `open`（跳过该供应商）→ 冷却结束 → `half-open`（放行**一个探测请求**）→ 成功则回到 `closed`。

`half-open` 只放一个探测请求，而不是一次性放全部流量——这样供应商还在故障时不会被打垮，恢复后又能立刻恢复服务。

### 排障

每次调用的响应都带 `meta.attempts`，完整记录这次请求经历了哪些密钥 / 供应商：

```json
"meta": {
  "provider": "serper",
  "tookMs": 842,
  "degraded": false,
  "ignoredParams": [],
  "attempts": [{ "provider": "serper", "ok": true, "tookMs": 842 }]
}
```

管理后台的「搜索调试」页可以把这条链路可视化——直观看到命中哪家、用了哪把 key、是否发生降级。这也是排查"为什么这次慢了"最快的方式。

---

## 扩展新供应商

只需三步：

1. 在 `src/providers/` 下新建适配器，实现 `SearchProvider` 接口（`search()` + `capabilities`）
2. 实现该家的 `classify()`——把各家不一致的状态码 / 报文翻译成统一的 `FaultKind`
3. 在 `src/providers/index.ts` 的 `PROVIDERS` 数组里注册

新增之后，系统会**自动为该供应商生成默认配置**，在界面上添加密钥即可使用，无需改动其它代码。

### 写适配器时的注意事项

- **`capabilities` 要如实声明**。声明了不支持的能力，调用方传参时就会被记入 `ignoredParams`，这是有意设计的——宁可明确告知，也不要假装支持后返回错数据。
- **`classify()` 是重点，不是附属品**。同一个 HTTP 状态码在不同供应商那里含义可能不同（例如某些家的 402 表示套餐超限、某些家表示额度耗尽）。判断错就会把一把好 key 隔离掉，或者该切供应商时却一直在换 key。
- **翻页语义各不同**。跨供应商降级时分页无法保持连续，切换后会从第一页重新开始（见 [limitations.md](./limitations.md)）。
