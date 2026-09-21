import CodeBlock from './CodeBlock';

const MCP_CONFIG = `{
  "mcpServers": {
    "searchhub": {
      "command": "searchhub",
      "args": ["mcp"]
    }
  }
}`;

const MCP_HTTP_CONFIG = `{
  "mcpServers": {
    "searchhub": {
      "url": "http://your-host:8787/mcp",
      "headers": { "x-api-key": "sh_xxxxxxxxxx" }
    }
  }
}`;

const CLI_EXAMPLE = `# 启动服务（默认 http://localhost:8787）
searchhub start

# 直接搜索，不经过 HTTP
searchhub search "openai" --size 5

# 查看供应商健康度
searchhub status

# 查看/清理日志
searchhub logs
searchhub logs --prune`;

export default function Guide() {
  return (
    <>
      <section className="card">
        <h3>三步上手</h3>
        <div className="doc-list">
          <div className="doc-step">
            <span className="badge accent">1</span>
            <div>
              <b>添加供应商密钥</b>
              <p>
                进入「密钥管理」，为 Serper / Tavily / Exa / AnySearch 各添加至少一把密钥。
                同一供应商可以加多把——
                一把失效会自动换下一把，这是容灾的第一层。加完点「测试」确认连通。
              </p>
            </div>
          </div>
          <div className="doc-step">
            <span className="badge accent">2</span>
            <div>
              <b>创建接入用的 API Key</b>
              <p>
                进入「API 授权」创建一个 API Key（形如 <span className="mono">sh_xxx</span>），
                明文只在创建时显示一次，请立即保存。你自己的业务系统用它来调用统一搜索接口。
              </p>
            </div>
          </div>
          <div className="doc-step">
            <span className="badge accent">3</span>
            <div>
              <b>接入调用</b>
              <p>
                调用 <span className="mono">POST /api/search</span>，带上{' '}
                <span className="mono">x-api-key</span>。完整字段与示例见「API 接口」页。
                不确定时先用「搜索调试」页发一次请求，能看到命中了哪家供应商、用了哪把密钥。
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>数据与日志目录</h3>
        <p className="sub">未显式配置时，一切落在用户主目录下（可用 SEARCHHUB_HOME 整体迁移）</p>
        <pre className="code-block">
{`~/.search-hub/
├── store.json                     供应商配置 + 供应商密钥密文 + API Key 哈希
└── log/
    └── searchhub-YYYY-MM-DD.log    按天切分，跨天自动新建`}
        </pre>
        <table style={{ marginTop: 12 }}>
          <tbody>
            <tr>
              <td style={{ width: 260 }} className="mono">SEARCHHUB_HOME</td>
              <td>根目录，默认 ~/.search-hub</td>
            </tr>
            <tr>
              <td className="mono">SEARCHHUB_LOG_RETENTION_DAYS</td>
              <td>日志保留天数，默认 14；设为 0 永久保留</td>
            </tr>
            <tr>
              <td className="mono">SEARCHHUB_SECRET</td>
              <td>供应商密钥的加密主密钥，未设置则明文落盘并告警</td>
            </tr>
            <tr>
              <td className="mono">SEARCHHUB_ADMIN_PASSWORD</td>
              <td>本后台的登录密码，未设置则启动时随机生成并打印在日志</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>密钥状态机</h3>
        <p className="sub">「密钥管理」页每一行的状态，都对应下面这几种情况</p>
        <table>
          <thead>
            <tr>
              <th style={{ width: 110 }}>状态</th>
              <th style={{ width: 190 }}>触发原因</th>
              <th>恢复方式</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <span className="badge ok">可用</span>
              </td>
              <td>正常</td>
              <td>—</td>
            </tr>
            <tr>
              <td>
                <span className="badge warn">冷却中</span>
              </td>
              <td>被限流（429）</td>
              <td>按对方返回的 Retry-After 自动恢复，默认 60 秒；也可点「解除冷却」</td>
            </tr>
            <tr>
              <td>
                <span className="badge danger">已隔离</span>
              </td>
              <td>密钥无效（401/403），或日 / 月 / 总配额耗尽</td>
              <td>
                无效：6 小时后自动解除；日配额：次日 UTC 0 点；月配额：次月 1 号 UTC 0 点；
                总配额不会自动恢复，需要调高配额，或点「重置用量」清零计数
              </td>
            </tr>
            <tr>
              <td>
                <span className="badge">已禁用</span>
              </td>
              <td>手动停用</td>
              <td>点「启用」</td>
            </tr>
          </tbody>
        </table>
        <div className="notice" style={{ marginTop: 14, marginBottom: 0 }}>
          三类配额可以同时设置，也可以只设其中一种，留空表示不限：
          <b>日配额</b>每天 UTC 0 点重置，<b>月配额</b>每月 1 号 UTC 0 点重置，
          <b>总配额</b>是累计上限、不随时间恢复。QPS 是每秒请求上限（令牌桶），与配额相互独立。
          密钥里留空的字段会继承「供应商配置」中的全局默认值（列表里带「继承」标记）。
        </div>
      </section>

      <section className="card">
        <h3>一次搜索会经历什么</h3>
        <pre className="code-block">
{`请求进入
  │
  ├─ 按优先级挑供应商（可在「供应商配置」调整）
  │     ├─ 熔断中？ ── 是 ──> 跳过，换下一家
  │     └─ 否
  │
  ├─ 从该供应商的密钥池里轮询取一个可用密钥（受 QPS / 日配额约束）
  │
  ├─ 发起请求（受超时时间约束）
  │     ├─ 成功 ──> 返回结果（meta 里记录用了哪家、哪把密钥）
  │     └─ 失败 ──> 按故障分类处理
  │            ├─ 密钥问题（无效/限流/配额）──> 换下一个密钥重试
  │            ├─ 供应商故障（5xx/超时）  ──> 计入熔断，换下一家供应商
  │            └─ 参数问题（400）        ──> 换下一家供应商
  │
  └─ 全部失败 ──> 返回 502 + attempts 完整链路`}
        </pre>
        <p className="sub" style={{ marginTop: 12 }}>
          响应里的 <span className="mono">meta.attempts</span> 就是上面这条链路的真实记录，排障时先看它。
        </p>
      </section>

      <section className="card">
        <h3>常见问题排查</h3>
        <table>
          <thead>
            <tr>
              <th style={{ width: 210 }}>现象</th>
              <th>原因与处理</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>401 缺少 x-api-key 请求头</td>
              <td>请求没带 API Key，去「API 授权」创建并加到请求头</td>
            </tr>
            <tr>
              <td>401 API Key 无效或已吊销</td>
              <td>Key 被吊销或抄错了；重新创建一个</td>
            </tr>
            <tr>
              <td>502 所有搜索供应商均不可用</td>
              <td>
                看 attempts：若全是 keyInvalid，说明密钥都失效了，去「密钥管理」换密钥；
                若全是 no_key_available，说明密钥都在冷却，等冷却或点「解除冷却」
              </td>
            </tr>
            <tr>
              <td>400 请求参数被所有供应商拒绝</td>
              <td>检查 q 是否为空、pageSize 是否超过 50</td>
            </tr>
            <tr>
              <td>结果条数少于 pageSize</td>
              <td>供应商本身召回不足；也可增加另一家的密钥提高可用率</td>
            </tr>
            <tr>
              <td>翻页没变化</td>
              <td>Exa 不支持翻页，page&gt;1 会被忽略（meta.ignoredParams 里有记录）</td>
            </tr>
            <tr>
              <td>某家一直没被用到</td>
              <td>优先级数字越小越优先；主力供应商正常时不会启用备用</td>
            </tr>
            <tr>
              <td>后台进不去 / 提示登录过期</td>
              <td>令牌默认 8 小时；改密码会让所有旧令牌立即失效</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>MCP 接入（给 AI 客户端用）</h3>
        <p className="sub">
          内置 MCP 服务（stdio 传输），Claude Desktop / Cursor 等客户端可直接把统一搜索当作工具调用，
          无需关心密钥轮换与供应商切换
        </p>
        <table>
          <tbody>
            <tr>
              <td style={{ width: 170 }} className="mono">searchhub_search</td>
              <td>执行搜索，支持 q / pageSize / providerId / timeRange / site / country / lang</td>
            </tr>
            <tr>
              <td className="mono">searchhub_status</td>
              <td>查看各供应商熔断状态、密钥可用数与调用统计</td>
            </tr>
            <tr>
              <td className="mono">searchhub_providers</td>
              <td>列出内置供应商及其能力（时间范围、站内限定、翻页等）</td>
            </tr>
          </tbody>
        </table>
        <p className="sub" style={{ marginTop: 14 }}>
          本地客户端（stdio）：claude_desktop_config.json
        </p>
        <CodeBlock code={MCP_CONFIG} />
        <p className="sub" style={{ marginTop: 14 }}>
          远程连接（Streamable HTTP）：主服务启动后即在同端口暴露 <span className="mono">/mcp</span>，
          用「API 授权」里的 Key 鉴权；也可以单独跑 <span className="mono">searchhub mcp --http --port 8788</span>
        </p>
        <CodeBlock code={MCP_HTTP_CONFIG} />
      </section>

      <section className="card">
        <h3>命令行用法</h3>
        <p className="sub">
          全局安装后可在任意目录执行；开发期用 <span className="mono">npm link</span> 更方便
        </p>
        <CodeBlock code={CLI_EXAMPLE} />
      </section>

      <section className="card">
        <h3>安全建议</h3>
        <div className="doc-list">
          <div className="doc-step">
            <span className="badge danger">!</span>
            <div>
              <b>务必设置 SEARCHHUB_SECRET 与 SEARCHHUB_ADMIN_PASSWORD</b>
              <p>前者决定供应商密钥是否加密落盘，后者决定后台能否被随意登录。</p>
            </div>
          </div>
          <div className="doc-step">
            <span className="badge danger">!</span>
            <div>
              <b>不要把数据目录提交到代码仓库</b>
              <p>
                <span className="mono">~/.search-hub/store.json</span> 含密钥密文，
                即使泄露也无法直接利用（除非同时泄露 SEARCHHUB_SECRET），但仍应纳入备份与权限管控。
              </p>
            </div>
          </div>
          <div className="doc-step">
            <span className="badge danger">!</span>
            <div>
              <b>定期轮换 API Key</b>
              <p>接入方泄漏时，在「API 授权」吊销即可，服务端只存哈希，无需担心拖库后被反推。</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
