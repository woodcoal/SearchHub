# SearchHub · 统一搜索网关

把多家异构搜索 API（内置 **Serper** / **Tavily** / **Exa** / **AnySearch**）收敛成一套统一协议，并集中管理密钥：
**密钥自动轮换、失效自动换 key、供应商整体故障自动切换、连续失败自动熔断**。
对外提供统一的认证搜索接口与 **MCP 接口**，对内提供带密码登录的管理后台。

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
| `searchhub keys update serper <id\|标签> --value 新密钥 --daily-quota 1000` | 修改密钥内容 / 标签 / QPS / 配额 / 启停 |
| `searchhub keys reset-usage serper <id\|标签>` | 清零用量计数并解除隔离 |
| `searchhub keys test serper <id\|标签>` | 测试单个密钥连通性 |
| `searchhub keys remove serper <id\|标签>` | 删除供应商密钥 |
| `searchhub usage [--json]` | 查看调用用量统计（分供应商 / 分密钥） |
| `searchhub mcp` | 以 stdio 启动 MCP 服务（本地客户端） |
| `searchhub mcp --http --port 8788` | 以 Streamable HTTP 启动 MCP 服务（可远程连接） |
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

## 系统设置

管理后台「系统设置」页可以改两项系统级配置，它们保存在 **独立于数据文件** 的
`~/.search-hub/settings.json` 里——这样即使数据目录被迁移走，系统也知道数据在哪、密码是什么。

```
~/.search-hub/
├── settings.json     系统设置（数据目录 + 后台密码哈希）
├── store.json        业务数据（随 dataDir 迁移）
└── log/              日志（随 dataDir 迁移）
```

### 后台密码

- 优先级：**界面设置 > 环境变量 `SEARCHHUB_ADMIN_PASSWORD` > 启动随机生成**
- 只保存 scrypt 哈希；修改后**所有已登录会话立即失效**，需要重新登录
- 一旦在界面设置过密码，环境变量里的密码不再生效（除非清空 settings.json 中的 `adminPasswordHash`）
- 忘记密码时：删掉 `settings.json` 里的 `adminPasswordHash` 并重启，回到环境变量密码

### 数据目录迁移

在界面填入新目录点「迁移」即可，流程是：

1. 创建新目录
2. 把当前内存中的完整数据写入 `<新目录>/store.json`（若目标已存在，先备份为 `store.json.bak-<时间戳>`）
3. 搬移历史日志文件（**当天正在写入的日志留在原处**，避免 Windows 文件占用）
4. 写入 `settings.json`，日志立即切换到 `<新目录>/log`
5. 旧目录的文件**全部保留，不做删除**

对应接口：`GET /api/admin/settings`、`POST /api/admin/password`、`POST /api/admin/data-dir`。

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
| `SEARCHHUB_SETTINGS_FILE` | 系统设置文件，默认 `<home>/settings.json` |
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
布局适配移动端：窄屏下页签横向滚动、供应商卡片自动改单列、密钥表格转为卡片式堆叠、长表格可横向滚动。

「关于」页汇总软件信息（版本、作者、仓库、许可）、运行环境（Node 版本、平台、运行时长）、
内置供应商清单与能力、MCP 工具说明以及数据/日志路径；页面底部固定展示版权与版本信息。

## 内置供应商

| 供应商 | 定位 | 鉴权头 | 能力 | 翻页 |
|---|---|---|---|---|
| `serper` | Google SERP 原始结果 | `X-API-KEY` | web / 时间范围 / 站内 / 地域 / 语言 | 支持 |
| `tavily` | 面向 Agent 的实时搜索 | `Authorization: Bearer tvly-…` | web / 时间范围 / 站内 / 地域 / 语言 / 安全搜索 | 不支持 |
| `exa` | 神经（语义）搜索 | `x-api-key` | web / 时间范围 / 站内 | 不支持 |
| `anysearch` | 统一实时搜索（支持匿名降级） | `Authorization: Bearer as_sk_…` | web / 语言 / 地域（zone） | 不支持 |

各家返回结构差异由适配器归一化为统一的 `SearchResult`；错误码也统一翻译为内部故障分类，
因此「429 到底是限流还是配额耗尽」「432/433 是套餐超限」这类差异不需要调用方关心。

新增供应商只需三步：写适配器 → 写 `classify()` → 注册进 `PROVIDERS`（见文末）。

## 密钥配额

每把密钥可以同时设置三类配额，互不冲突，留空表示不限：

| 配额 | 说明 | 重置 |
|---|---|---|
| 日配额 `dailyQuota` | 当天累计调用上限 | 每天 UTC 0 点自动归零 |
| 月配额 `monthlyQuota` | 当月累计调用上限 | 每月 1 号 UTC 0 点自动归零 |
| 总配额 `totalQuota` | 累计调用上限（如一次性购买的额度包） | **不随时间恢复**，需调高配额或「重置用量」 |

任一配额用尽，该密钥立即进入隔离状态并自动切换到同供应商的其它密钥；
界面上可以直观看到 `已用/上限` 三个数字，也可用「重置用量」清零（例如充值后）。
另有独立的 QPS 令牌桶控制瞬时速率。

### 内置默认配额（按各家免费额度预设）

首次启动时，各供应商会带一组「免费额度」导向的默认值，避免默认配置把免费额度一把烧完：

| 供应商 | 全局 QPS | 日配额 | 月配额 | 总配额 | 依据 |
|---|---|---|---|---|---|
| `serper` | 1 | 不限 | 不限 | **2500** | 免费一次性 2500 credits，不按月重置 |
| `tavily` | 1 | 100 | **1000** | 不限 | 免费 1000 credits/月（basic 搜索 1 credit） |
| `exa` | 1 | 100 | **1000** | 不限 | 免费 tier 每月 $10 额度（约 1400 次），保守取 1000 |
| `anysearch` | 1 | 不限 | 不限 | 不限 | 免费 key 只有速率限制，未给总量配额 |

- 这些是**供应商级默认值**，密钥里留空的字段继承它们；也可以在「供应商配置」里按实际套餐改
- 日配额是突发保护，不会限制正常使用（100/天 × 30 天 > 月配额）
- 升级已有数据文件时会做一次性迁移：仍为「不限」的供应商级配额会填入上表建议值，
  之后你在界面上显式设置过的值不会被覆盖

### 供应商级全局默认

「供应商配置」里还能设置该供应商的 **全局 QPS 与三类配额**：

- 密钥里**留空**的 QPS / 配额字段会继承供应商的全局设置（界面上以「继承」标记提示）
- 密钥里显式填写的值优先于全局设置
- 全局与密钥都留空，则表示不限

这样常见的做法是：先给某个供应商统一设一个安全水位（例如全局 1 QPS、日 3000），
再对个别密钥单独调高，避免每加一把密钥都要重复填参数。

## MCP 接口

内置 MCP（Model Context Protocol）服务，AI 客户端可直接把统一搜索当作工具调用。支持两种传输方式：

| 工具 | 说明 |
|---|---|
| `searchhub_search` | 执行搜索，参数：`q`、`pageSize`、`page`、`providerId`、`timeRange`、`site`、`country`、`lang` |
| `searchhub_status` | 查看各供应商熔断状态、密钥可用数与调用统计 |
| `searchhub_providers` | 列出内置供应商及其能力 |

### 方式一：stdio（本地客户端）

```json
{
  "mcpServers": {
    "searchhub": { "command": "searchhub", "args": ["mcp"] }
  }
}
```

stdio 传输下 stdout 属于协议通道，因此日志统一走 stderr 与文件，不会污染协议。

### 方式二：Streamable HTTP（远程连接）

主服务启动后即在同一端口暴露 MCP 端点，无需额外进程：

```
POST http://<host>:8787/mcp
x-api-key: sh_xxxxxxxxxx        # 管理后台「API 授权」创建的 Key，或 SEARCHHUB_API_TOKEN
content-type: application/json
accept: application/json, text/event-stream
```

- 采用**无状态模式**（每个请求独立处理，不维护会话），便于放在负载均衡后面水平扩展
- 鉴权复用统一搜索接口的 API Key，未带或无效一律 401
- `GET /mcp`、`DELETE /mcp` 返回 405（无状态模式仅支持 POST）
- 典型客户端配置（Cursor / 云端 IDE 的 `mcp.json`）：

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

也可以只跑 MCP、不暴露管理界面，适合部署在远程机器上：

```bash
searchhub mcp --http --port 8788           # 默认监听 0.0.0.0:8788/mcp
searchhub mcp --http --port 8788 --path /api/mcp
```

## 日志

每次搜索都会写一条结构化日志（`event: search`），含检索词、命中供应商、使用的密钥、
结果条数、耗时、尝试次数与是否降级，成功与失败都记录。

管理后台「日志」页可直接查看：

- 按天选择日志文件（默认今天），可列出所有历史文件并一键切换
- 按级别过滤（INFO / WARN / ERROR 及以上）、按关键词过滤（检索词、供应商、消息）
- 「仅搜索事件」开关：只看搜索，或查看包括启动、报错在内的全部运行日志
- 自动刷新（5 秒）便于边压测边观察；每行的 ⋮ 可以看到该条的完整原始 JSON

接口：`GET /api/admin/logs?date=2026-09-21&level=warn&onlySearch=true&keyword=openai&limit=200`

命令行：

```bash
searchhub logs              # 日志目录、保留策略与文件占用
searchhub logs --prune      # 立即清理过期日志
```

## 搜索 Skill（给 AI 智能体用）

`skill/searchhub/` 是一个可独立分发的技能包，让智能体直接具备联网检索能力：

```
skill/searchhub/
├── SKILL.md                      # 技能定义（智能体读取）
├── README.md                     # 安装与配置说明
├── .env.example
├── references/api.md             # 接口、错误码、MCP、供应商能力差异
└── scripts/searchhub_search.mjs  # 零依赖 Node 脚本，可直接执行
```

```bash
# 安装到项目级 / 用户级技能目录
cp -r skill/searchhub .codebuddy/skills/searchhub
cp -r skill/searchhub ~/.codebuddy/skills/searchhub

# 直接使用脚本
SEARCHHUB_BASE_URL=http://127.0.0.1:8787 SEARCHHUB_API_KEY=sh_xxx \
  node skill/searchhub/scripts/searchhub_search.mjs "统一搜索网关" --size 5
node skill/searchhub/scripts/searchhub_search.mjs --status
```

技能内部按「MCP 工具 > HTTP 接口 > CLI」的优先级选择调用方式，
并写明了引用规范（用 `results[].url` 作为来源）与 502 时的处置建议。

## 用量统计

「用量统计」页按**尝试次数**汇总每个供应商与每把密钥的使用情况：

- 概览：总调用、成功、失败、成功率、平均耗时
- 趋势：最近 24 小时（按小时）与最近 14 天（按天）的柱状图，红色部分表示失败
- 分供应商：命中次数、成功率、平均耗时、最近成功时间与最近错误
- 分密钥：每把密钥的调用/成功/失败/成功率/平均耗时/最近使用时间与最近错误，
  能快速发现「某把 key 一直没被用到」「某把 key 频繁失败」

统计口径为**尝试次数**：一次搜索可能包含换密钥、换供应商的多轮尝试，都会分别计数；
「无可用密钥」「供应商熔断被跳过」也会记录，便于定位容量问题。

接口：`GET /api/admin/usage`；命令行：`searchhub usage [--json]`。

数据保存在进程内存中（重启清零），多实例部署需换成 Redis 实现。

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
