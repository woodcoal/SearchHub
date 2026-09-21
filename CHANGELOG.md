# 更新日志

本文件记录 SearchHub 的版本变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> 说明：`0.1.1` – `0.1.8` 是集中开发期的版本，发布节奏很快（同一天内多次发版），
> 未逐版维护变更记录。下面把它们按主题合并记录。

---

## [0.1.10] — 2026-09-22

### 修复

- **`docker-compose.yml` 的 healthcheck 缺少一个右括号**，导致 `node -e` 载荷无法解析
  （`SyntaxError: missing ) after argument list`）。后果是 `docker compose up -d --build`
  之后容器会被永久标记为 `unhealthy`，即使服务本身运行正常。`docker run` 走 Dockerfile
  内的 HEALTHCHECK，不受影响。
- `/api/health` 的 healthcheck 命令在 Dockerfile 与 docker-compose.yml 中重复定义，
  容易改了一处漏另一处（正是上面这个 bug 的成因）。
- **`server.json` 的 `description` 超过官方 MCP Registry 的 100 字符上限**（原为 226 字符），
  会导致 `mcp-publisher validate` / `publish` 被拒（422）。已压缩为 98 字符。

### 变更

- **Dockerfile 基础镜像从 `node:20-bookworm-slim` 升级到 `node:24-bookworm-slim`**。
  Node.js 20 已于 2026-04-30 终止支持，不再接收安全补丁；本项目负责保管供应商密钥、
  管理员会话与调用方凭据，不应运行在 EOL 运行时上。
  两个构建阶段（build / runtime）已同步更新。
- `package.json` 的 `engines.node` 从 `>=20` 调整为 `>=22`，避免安装到已 EOL 的运行时。
- `package.json` 的 `files` 补充 `README.en.md` 与 `docs`——此前英文 README 不会被打进
  npm 包，npm 页面对英文用户仍然只显示中文。
- `package.json` 的 `description` 改为中英双语，英文在前，便于 npm 搜索与列表页展示。
- `package.json` 补充 `mcpName` 字段，用于官方 MCP Registry 的 npm 包归属校验。

### 新增

- `docs/` 目录与 5 篇详细文档：
  [quotas.md](./docs/quotas.md)（三级配额、内置默认配额表、供应商级继承规则）、
  [logging.md](./docs/logging.md)（日志切分与保留、调用日志、用量统计口径）、
  [data-and-settings.md](./docs/data-and-settings.md)（数据目录、系统设置、密码优先级与找回、数据迁移）、
  [providers.md](./docs/providers.md)（供应商能力矩阵、故障分类与熔断、扩展新供应商）、
  [limitations.md](./docs/limitations.md)（已知限制与适用边界）。
- `.github/workflows/ci.yml`：类型检查 + 构建。
- `.github/workflows/publish-mcp.yml`：打 tag 或手动触发时，用 GitHub OIDC 认证把
  `server.json` 发布到官方 MCP Registry（无需任何 secret）。
- `CHANGELOG.md`（本文件）。
- `server.json`：官方 MCP Registry 服务清单。
- `llms.txt`：便于 AI 助手准确读取并推荐本项目。
- README 增加 npm / license / node / CI 徽章，以及文档索引。
- `docs/images/` 界面截图（5 张），并在两个 README 中新增「界面预览」/「Screenshots」小节：
  概览、搜索调试（含一次真实的密钥配额耗尽 → 自动换 Key 成功的调用链路）、
  供应商配置、用量统计、API 接口。

### 文档

- 两个 README 中的 Docker 快速开始不再使用 `change-me` 这类弱占位符，改为用
  `node -e "require('crypto')..."` 直接生成强随机值（Node 本就是运行前提，跨平台一致）。
  原有写法会让 compose 的 `${VAR:?}` 守卫误判为"已设置"，带着弱密码启动。
- 补充说明 `SEARCHHUB_SECRET` 是密钥解密主密钥，**设置后不可更改**——更改会导致已落盘的
  供应商密钥无法解密。
- `.env.example` 注释改为中英双语，并补上两个密钥的生成命令。

### 其它

- `.gitignore` 增加 `.codebuddy/`；移除 `package-lock.json`（`Dockerfile` 使用 `npm ci`，
  锁文件必须入库，忽略它与实际做法矛盾）。
- 从 git 跟踪中移除 `.codebuddy/`（该目录与 `skill/searchhub/` 内容重复，且属于本地助手配置）。

---

## [0.1.9] — 2026-09-22

### 文档

- 重写 README，突出容灾定位与快速上手：新增「为什么用 SearchHub？」「30 秒启动」
  「第一次配置」「Docker 部署」等章节。
- 新增英文版 `README.en.md`，中文 README 顶部加入语言切换链接。

### 新增

- `Dockerfile`（多阶段构建，非 root 用户运行，内置 healthcheck）与 `docker-compose.yml`。
- `.dockerignore`。
- `.env.example` 补充 `TAVILY_KEYS` / `ANYSEARCH_KEYS` 播种变量。

---

## [0.1.6] — 2026-09-21

### 新增

- 管理后台日志页签；搜索 Skill（可独立分发给 AI 智能体）。
- MCP 支持 Streamable HTTP 传输（无状态）。
- 用量统计页：按尝试次数汇总供应商与密钥的成功率、耗时、最近错误。
- 调用日志持久化到 `calls.jsonl`（重启不清零，内存与文件均保留最近 1000 条）。
- 按各家免费额度预设的默认 QPS 与配额，并按 `quotaSeedVersion` 做版本化迁移
  （只覆盖仍等于上一版默认值的字段，手动改过的一律保留）。

### 修复

- 密钥 QPS 留空时无法保存。

---

## [0.1.4] — 2026-09-21

### 新增

- 新增 Tavily、AnySearch 供应商适配器（此前仅有 Serper 与 Exa）。
- 三级配额（日 / 月 / 总）+ 独立 QPS 令牌桶。
- 供应商密钥编辑能力。
- 系统设置页：支持修改后台密码与数据目录（含自动迁移，旧目录文件保留不删除）。
- 管理后台内置使用说明与 API 接口说明页。
- 管理后台响应式改造、SVG logo、折叠操作菜单、「关于」页与页脚。

### 界面

- 密钥操作下拉菜单在点击外部、失焦或按 Esc 时自动收起。
- 概览页密钥表格固定列宽、单行省略；全站徽章不换行。

---

## [0.1.1] — 2026-09-21

首个公开版本。

### 新增

- 统一搜索网关：聚合 Serper 与 Exa，统一请求 / 响应协议，归一化各家的返回结构与错误码。
- 密钥池与自动轮换；故障分级（换 key / 换供应商 / 熔断）。
- 管理后台（密码登录）、API Key 授权、搜索调试台。
- 全局 CLI（`searchhub` 命令）。
- 数据默认落在 `~/.search-hub`；日志按天切分并支持保留 N 天。
- MIT 许可与版权信息。
