# SearchHub · 统一搜索网关

把多家异构搜索 API（当前内置 **Serper** + **Exa**）收敛成一套统一协议，并集中管理密钥：
**密钥自动轮换、失效自动换 key、供应商整体故障自动切换、连续失败自动熔断**。
对外提供统一的认证搜索接口，对内提供带密码登录的管理后台。

```
调用方 ──x-api-key──> /api/search ──> SearchHub ──> Serper Adapter ──> KeyPool(多把 key 轮换)
                                                  ──> Exa    Adapter ──> KeyPool(多把 key 轮换)
                                                        └── 失败分级：换 key / 换供应商 / 熔断

管理员 ──密码登录──> /api/admin/*（密钥、供应商、API Key 管理 + 调试台）
```

## 快速开始

```bash
npm install
cp .env.example .env          # 设置 SEARCHHUB_SECRET 与 SEARCHHUB_ADMIN_PASSWORD
npm run dev                   # 后端 API + 管理界面：http://localhost:8787
npm run dev:web               # 前端热更新：http://localhost:5173（已代理 /api）
```

生产模式：

```bash
npm run build                 # 编译后端到 dist/、前端到 web/dist/
npm start                     # 单进程同时提供 API 与管理界面
```

## 包安装（已发布到 npm）

npm 页面：https://www.npmjs.com/package/searchhub

```bash
npm install -g searchhub      # 全局安装，得到 searchhub 命令
searchhub start               # 任意目录执行，服务默认 http://localhost:8787
```

要求 **Node.js >= 20**。安装后打开 http://localhost:8787 进入管理后台（首次需用管理密码登录）。

其他安装方式：

```bash
npx searchhub --help          # 不安装，直接试用
npm install -g searchhub@latest   # 升级到最新版本
npm uninstall -g searchhub        # 卸载
```

作为项目依赖安装（便于在 CI 或容器里固定版本）：

```bash
npm install searchhub         # 之后用 npx searchhub 启动
```

> 包内只包含构建产物（`dist/`、`web/dist/`）与文档，
> `react` / `react-dom` 属于 devDependencies，运行时不会安装。

从源码安装（参与开发时用这个）：

```bash
npm install                   # 安装依赖
npm run build                 # 编译后端到 dist/、前端到 web/dist/
npm install -g .              # 从本地目录安装
```

开发调试用 `npm link` 更好：会在全局与源码目录之间建立链接，改完代码 `npm run build` 后立刻生效，无需反复安装。

```bash
npm link                      # 只需执行一次
npm run build                 # 之后每次改代码重新构建即可
```

### CLI 命令

| 命令 | 说明 |
|---|---|
| `searchhub start` | 启动服务（默认命令，同时提供 API 与管理界面） |
| `searchhub search "关键词"` | 直接调用统一搜索接口，不经过 HTTP |
| `searchhub status` | 查看各供应商健康度与密钥状态 |
| `searchhub keys list` | 列出所有供应商密钥 |
| `searchhub keys add serper <密钥> --label 主key --qps 2` | 添加供应商密钥 |
| `searchhub keys test serper <id\|标签>` | 测试单个密钥连通性 |
| `searchhub keys remove serper <id\|标签>` | 删除供应商密钥 |
| `searchhub apikey create <名称>` | 创建接入用 API Key（明文只显示一次） |
| `searchhub apikey list` / `revoke <id>` | 列出 / 吊销 API Key |

通用选项：`--port`、`--host`、`--data <数据文件路径>`、`--provider`、`--size`、`--json`。
CLI 会自动读取当前目录下的 `.env`（不覆盖已有环境变量）。

```bash
searchhub start --port 9000 --data ./data/store.json
searchhub search "openai" --size 5 --provider serper
```

### 版本发布（维护者）

```bash
# 注意：发布前需移除 package.json 中的 "private": true
npm version patch             # 或 minor / major
npm publish                   # 会自动执行 prepublishOnly（即 npm run build）
```

发布内容由 `files` 字段控制，只包含 `dist/`、`web/dist/`、`README.md`、`.env.example`；
`react` / `react-dom` 已放在 devDependencies，因为前端在构建期就打成了静态资源，运行时不需要。

## 数据与日志目录

未显式配置时，一切落在用户主目录下（可用 `SEARCHHUB_HOME` 整体改到别处）：

```
~/.search-hub/
├── store.json                    供应商配置 + 密钥密文 + API Key 哈希
└── log/
    ├── searchhub-2026-09-21.log   按天切分，跨天自动新建
    └── searchhub-2026-09-22.log
```

- 日志文件名为 `searchhub-YYYY-MM-DD.log`，**跨天自动切换，无需额外轮转组件**
- 每次服务启动、以及 `searchhub logs --prune` 时会清理超过保留天数的文件
- 保留天数：`SEARCHHUB_LOG_RETENTION_DAYS`，默认 **14 天**；设为 `0` 表示永久保留
- 按文件名中的日期判断过期，不依赖文件 mtime，避免修改时间被改写导致误删/漏删
- 日志同时输出到控制台，便于 `docker logs`；设为 `SEARCHHUB_LOG_STDOUT=false` 则只写文件

```bash
searchhub logs                      # 查看日志目录、保留策略与文件占用
searchhub logs --prune              # 立即清理过期日志
searchhub start --home D:/searchhub-data
```

敏感信息（API Key、管理令牌、密钥原文、登录密码）在日志中统一做了 redact 脱敏。

## 认证体系

### 1. 管理后台：密码登录

- 环境变量 `SEARCHHUB_ADMIN_PASSWORD` 设置密码，运行时只保留 scrypt 哈希
- 未设置时，服务启动会**随机生成**一个密码并打印在启动日志中（重启即变，请务必在 `.env` 中固定）
- 登录接口 `POST /api/admin/login {"password":"..."}` 返回会话令牌（HMAC 签名，默认 8 小时有效）
- 会话密钥混入密码哈希，**改密码后所有旧令牌立即失效**
- 管理界面右上角可退出登录；脚本调用可用环境变量主管理令牌 `SEARCHHUB_ADMIN_TOKEN` 免登录

### 2. 统一搜索接口：API Key 授权

- 在管理界面「API 授权」页创建 API Key，明文**只在创建时返回一次**，服务端只存 sha256 哈希
- 调用方通过请求头传入：`x-api-key: sh_xxx`（也支持 `Authorization: Bearer sh_xxx`）
- 支持吊销（立即失效，记录保留）与删除
- 环境变量 `SEARCHHUB_API_TOKEN` 可作为主 Key 使用，便于应急与 CI
- 健康检查 `/api/health` 是公开接口，不含敏感信息

> 所有 POST 接口都必须带 `content-type: application/json` 与请求体；
> 无请求体的 POST（`curl -X POST <url>`）会被 Fastify 拒绝（415 / 400），需补 `-d '{}'`。

## 环境变量

| 变量 | 说明 |
|---|---|
| `PORT` / `HOST` | 服务监听地址，默认 `8787` / `0.0.0.0` |
| `SEARCHHUB_HOME` | 根目录，默认 `~/.search-hub` |
| `DATA_FILE` | 供应商配置、供应商密钥密文、API Key 哈希的存储文件，默认 `<home>/store.json` |
| `SEARCHHUB_LOG_DIR` | 日志目录，默认 `<home>/log` |
| `SEARCHHUB_LOG_RETENTION_DAYS` | 日志保留天数，默认 `14`；设为 `0` 永久保留 |
| `SEARCHHUB_LOG_STDOUT` | 是否同时输出到控制台，默认 `true` |
| `SEARCHHUB_SECRET` | 供应商密钥 AES-256-GCM 加密落盘；留空则明文存储并告警 |
| `SEARCHHUB_ADMIN_PASSWORD` | **管理后台登录密码**，留空则随机生成并打印在启动日志 |
| `SEARCHHUB_SESSION_TTL_MS` | 登录会话有效期，默认 8 小时 |
| `SEARCHHUB_API_TOKEN` | 主 API Key（可选，应急 / CI） |
| `SEARCHHUB_ADMIN_TOKEN` | 主管理令牌（可选，脚本免登录） |
| `SERPER_KEYS` / `EXA_KEYS` | 首次启动时播种供应商密钥，多个用英文逗号分隔 |

## 统一搜索接口

```bash
curl -X POST http://localhost:8787/api/search \
  -H 'content-type: application/json' \
  -H 'x-api-key: sh_xxxxxxxxxx' \
  -d '{"q":"openai","pageSize":10,"timeRange":"week","site":"github.com"}'
```

请求字段：`q`(必填)、`page`、`pageSize`(≤50)、`country`、`lang`、`timeRange`(`day|week|month|year`)、`site`、`safeSearch`。

响应：

```json
{
  "query": { "q": "openai", "pageSize": 10 },
  "results": [{ "title": "...", "url": "...", "snippet": "...", "provider": "serper" }],
  "meta": {
    "provider": "serper",
    "keyId": "9f2c...",
    "tookMs": 842,
    "degraded": false,
    "ignoredParams": [],
    "attempts": [{ "provider": "serper", "ok": true, "tookMs": 842 }]
  }
}
```

`meta.attempts` 完整记录了这次调用经历了哪些密钥/供应商，排障时非常有用。

### 接口清单

| 接口 | 认证 | 说明 |
|---|---|---|
| `GET /api/health` | 公开 | 供应商健康度（不含密钥信息） |
| `POST` / `GET /api/search` | API Key | 统一搜索接口 |
| `POST /api/admin/login` | 密码 | 登录，返回会话令牌 |
| `GET /api/admin/state` | 登录会话 | 供应商/密钥/统计全量状态 |
| `POST /api/admin/search` | 登录会话 | 调试台搜索，无需 API Key |
| `POST /api/admin/providers/:id` | 登录会话 | 修改供应商配置 |
| `POST` / `PATCH` / `DELETE /api/admin/keys[/...]` | 登录会话 | 供应商密钥增删改、解除冷却、连通性测试 |
| `GET` / `POST /api/admin/api-keys`、`POST /:id/revoke`、`DELETE /:id` | 登录会话 | API Key 管理 |

## 管理界面

`http://localhost:8787`（生产构建后）或 `http://localhost:5173`（开发模式）。首次进入需要密码登录。

- **概览**：各供应商健康度、熔断状态、可用/冷却/隔离密钥数、成功率、最近调用日志
- **密钥管理**：增删供应商密钥、启停、解除冷却、单密钥连通性测试；密钥只回显后 4 位
- **供应商配置**：启停、优先级、超时、单供应商最大换 key 次数、熔断阈值与冷却时长
- **API 授权**：创建 / 吊销 / 删除 API Key，含接入示例
- **搜索调试**：用统一协议真实调用，直观看到命中哪家供应商、用了哪把 key、是否降级

界面支持**深色 / 亮色主题**，右上角一键切换，选择会记住；未手动选择时跟随系统偏好。

## 容灾规则

| 故障类型 | 判定 | 系统动作 |
|---|---|---|
| `keyInvalid` (401/403) | 密钥无效 | 该 key 隔离 6 小时，**立即换下一个 key** |
| `keyRateLimited` (429) | 被限流 | 按 `Retry-After` 冷却（缺省 60s），换下一个 key |
| `keyQuotaExhausted` (402/额度提示) | 配额耗尽 | 冷却到次日 UTC 0 点，换下一个 key |
| `providerUnavailable` (5xx/超时) | 供应商故障 | 不惩罚 key，计入熔断计数，**切换供应商** |
| `badRequest` (400) | 请求有问题 | 不重试该供应商，直接换下一家 |
| 全部失败 | — | 返回 502 + 完整 attempts（若全是 400 则返回 400） |

熔断：连续失败达阈值 → `open`（跳过该供应商）→ 冷却结束 → `half-open`（放行一个探测请求）→ 成功则 `closed`。

## 扩展新供应商

1. 在 `src/providers/` 新建适配器，实现 `SearchProvider`（`search()` + `capabilities`）
2. 实现该家的 `classify()`：把各家不一致的状态码/报文翻译成统一的 `FaultKind`
3. 在 `src/providers/index.ts` 的 `PROVIDERS` 数组里注册

新增后系统会自动为该供应商生成默认配置，界面上添加密钥即可使用，无需改动其他代码。

## 版权与许可

```
Copyright (c) 2026 木炭 <woodcoal@qq.com>
```

本项目采用 [MIT 许可](./LICENSE)。你可以自由使用、修改与二次分发，
但需保留版权声明与许可声明。

- 作者：木炭
- 邮箱：woodcoal@qq.com
- 仓库：https://github.com/woodcoal/SearchHub
- 问题反馈：https://github.com/woodcoal/SearchHub/issues

> 注意：本项目会接入第三方搜索服务（Serper / Exa 等），
> 使用这些服务需遵守各自的服务条款与计费规则，与本项目许可无关。

## 已知限制

- 运行时状态（冷却、今日用量、统计）在内存中，**重启清零**；多实例部署需把 `KeyPool` 与 `Stats` 换成 Redis 实现（接口已按可替换设计）
- 会话令牌与 API Key 均无服务端会话表，吊销 API Key 立即生效，但已签发的登录令牌在过期前仍有效（改密码可强制失效）
- 跨供应商降级时分页语义不通用，切换后从第一页重新开始
- 两家都不支持 `safeSearch` 与图片/新闻检索，这些参数会被记录到 `meta.ignoredParams` 后忽略
- 数据文件为单文件 JSON + 原子写入，密钥规模很大时建议换数据库
