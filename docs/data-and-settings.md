# 数据目录、系统设置与认证

## 目录结构

默认根目录是 `~/.search-hub`，可用 `SEARCHHUB_HOME` 整体迁移到别处。

```text
~/.search-hub/
├── settings.json     系统设置（数据目录路径 + 后台密码哈希）
├── store.json        业务数据（供应商配置 + 供应商密钥密文 + API Key 哈希）
└── log/              日志（随数据目录一起迁移）
    ├── searchhub-YYYY-MM-DD.log
    └── calls.jsonl
```

关键设计：**系统设置独立于数据文件**。`settings.json` 只记录"数据在哪、密码是什么"，所以即使业务数据目录被整体搬走，服务仍然知道去哪里找数据。

---

## 系统设置

管理后台「系统设置」页可以改两项系统级配置，它们保存在 `~/.search-hub/settings.json`。

### 后台密码

优先级从高到低：

1. **界面设置**（写入 `settings.json` 的 `adminPasswordHash`）
2. 环境变量 `SEARCHHUB_ADMIN_PASSWORD`
3. 启动时**随机生成**并打印在启动日志中

要点：

- 只保存 **scrypt 哈希**，不存明文。
- 在界面里修改密码后，**所有已登录会话立即失效**，需要重新登录。
- 一旦在界面设置过密码，**环境变量里的密码不再生效**——除非清空 `settings.json` 中的 `adminPasswordHash`。
- **忘记密码时**：删掉 `settings.json` 里的 `adminPasswordHash` 并重启，就会回到环境变量密码（或重新随机生成）。

> 生产环境请务必在 `.env` 里固定 `SEARCHHUB_ADMIN_PASSWORD`。否则每次重启都会生成新密码，并把随机密码打印在日志里。

### 数据目录迁移

在界面填入新目录、点「迁移」即可。流程是：

1. 创建新目录
2. 把当前内存中的完整数据写入 `<新目录>/store.json`（若目标文件已存在，**先备份**为 `store.json.bak-<时间戳>`）
3. 搬移历史日志文件——**当天正在写入的日志留在原处**，避免 Windows 上的文件占用问题
4. 写入 `settings.json`，日志立即切换到 `<新目录>/log`
5. **旧目录的文件全部保留，不做删除**

对应接口：`GET /api/admin/settings`、`POST /api/admin/password`、`POST /api/admin/data-dir`

---

## 认证体系

### 1. 管理后台：密码登录

- 运行时只保留 scrypt 哈希，不保留明文。
- 登录接口：`POST /api/admin/login`，请求体 `{"password":"..."}`，返回会话令牌。
- 令牌为 **HMAC 签名**，默认有效期 8 小时（`SEARCHHUB_SESSION_TTL_MS`）。
- 会话密钥**混入密码哈希**——因此改密码后，所有旧令牌立即失效。
- 管理界面右上角可退出登录。
- 脚本调用可用 `SEARCHHUB_ADMIN_TOKEN` 免登录直接调 `/api/admin/*`。

### 2. 统一搜索接口：API Key 授权

- 在管理界面「API 授权」页创建 API Key。
- **明文只在创建时返回一次**，服务端只存 **SHA-256 哈希**。
- 调用方通过请求头传入：`x-api-key: sh_xxx`（也支持 `Authorization: Bearer sh_xxx`）。
- 支持**吊销**（立即失效，记录保留）与**删除**。
- `SEARCHHUB_API_TOKEN` 可作为主 Key 使用，便于应急与 CI。
- `/api/health` 是**公开接口**，不返回任何敏感信息。

### 3. 两套凭据不要混淆

| 凭据 | 用途 | 存放位置 |
|---|---|---|
| **供应商密钥**（Serper / Tavily / Exa / AnySearch 的 key） | 访问上游搜索服务 | `store.json`，AES-256-GCM 加密 |
| **调用方 API Key**（`sh_xxx`） | 保护你自己的 SearchHub 接口 | `store.json`，仅存 SHA-256 哈希 |

上游密钥**永远不会**通过 API 返回给调用方——这正是把 SearchHub 放在中间的意义。

---

## 加密与脱敏

| 数据 | 保护方式 |
|---|---|
| 供应商密钥 | AES-256-GCM 加密落盘（`SEARCHHUB_SECRET` 为主密钥）；未配置时明文存储并**在启动日志中告警** |
| 管理密码 | scrypt 哈希 |
| 登录会话令牌 | HMAC 签名，密钥混入密码哈希 |
| 调用方 API Key | SHA-256 哈希，明文仅创建时返回一次 |
| 日志内容 | API Key、管理令牌、密钥原文、密码统一 redact |

> **`SEARCHHUB_SECRET` 一旦设置就不要改动**——它是密钥的解密主密钥，改了之后已落盘的供应商密钥将无法解密，需要重新录入。
