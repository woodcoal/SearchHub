import CodeBlock from './CodeBlock';

const BASE = typeof window === 'undefined' ? 'http://localhost:8787/api' : `${window.location.origin}/api`;

const SEARCH_CURL = `curl -X POST ${BASE}/search \\
  -H 'content-type: application/json' \\
  -H 'x-api-key: sh_xxxxxxxxxx' \\
  -d '{"q":"openai","pageSize":10}'`;

const SEARCH_GET = `curl -G ${BASE}/search \\
  -H 'x-api-key: sh_xxxxxxxxxx' \\
  --data-urlencode 'q=openai' \\
  --data-urlencode 'pageSize=5'`;

const SEARCH_RESPONSE = `{
  "query": { "q": "openai", "pageSize": 2 },
  "results": [
    {
      "title": "OpenAI",
      "url": "https://openai.com/",
      "snippet": "OpenAI is an AI research and deployment company.",
      "publishedAt": "2026-09-01T00:00:00.000Z",
      "score": 0.93,
      "provider": "serper"
    }
  ],
  "meta": {
    "provider": "serper",
    "keyId": "7cf384ca-0443-4c3f-9848-39f92a2ae7e3",
    "tookMs": 842,
    "degraded": false,
    "switchedFrom": null,
    "ignoredParams": [],
    "attempts": [
      { "at": 1789961269036, "provider": "serper", "keyId": "7cf384ca", "ok": true, "tookMs": 842 }
    ]
  }
}`;

const SEARCH_JS = `const res = await fetch('${BASE}/search', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': process.env.SEARCHHUB_API_KEY,
  },
  body: JSON.stringify({ q: 'openai', pageSize: 10 }),
});

if (!res.ok) {
  const err = await res.json();
  throw new Error(err.message ?? res.status);
}

const { results, meta } = await res.json();
console.log(meta.provider, meta.degraded, results.length);`;

const LOGIN_CURL = `curl -X POST ${BASE}/admin/login \\
  -H 'content-type: application/json' \\
  -d '{"password":"你的管理密码"}'

# 返回：{ "token": "v1.1789999...", "expiresAt": 1789999000000 }`;

const ADMIN_CURL = `curl ${BASE}/admin/state -H 'x-admin-token: <登录返回的 token>'`;

const APIKEY_CURL = `curl -X POST ${BASE}/admin/api-keys \\
  -H 'content-type: application/json' \\
  -H 'x-admin-token: <token>' \\
  -d '{"name":"生产环境后端"}'

# 返回：{ "key": "sh_xxxxxxxxxx", "record": { "id": "...", "name": "生产环境后端" } }`;

const PROVIDER_CURL = `curl -X POST ${BASE}/admin/providers/exa \\
  -H 'content-type: application/json' \\
  -H 'x-admin-token: <token>' \\
  -d '{"enabled":true,"priority":1,"timeoutMs":15000,"maxKeyAttempts":3}'`;

const KEY_CURL = `# 添加供应商密钥
curl -X POST ${BASE}/admin/keys \\
  -H 'content-type: application/json' \\
  -H 'x-admin-token: <token>' \\
  -d '{"providerId":"serper","label":"主key","value":"真实密钥","qps":2,"dailyQuota":1000}'

# 修改：换密钥内容 + 改标签 / 启停 / 三类配额（value 留空则不改密钥内容）
curl -X PATCH ${BASE}/admin/keys/serper/<keyId> \\
  -H 'content-type: application/json' -H 'x-admin-token: <token>' \\
  -d '{"value":"新的密钥内容","label":"主key","enabled":true,"qps":2,
       "dailyQuota":1000,"monthlyQuota":30000,"totalQuota":null}'

# 解除冷却 / 清零用量 / 删除 / 连通性测试（无请求体也要带 content-type 与 {}）
curl -X POST ${BASE}/admin/keys/serper/<keyId>/reset       -H 'content-type: application/json' -d '{}' -H 'x-admin-token: <token>'
curl -X POST ${BASE}/admin/keys/serper/<keyId>/reset-usage -H 'content-type: application/json' -d '{}' -H 'x-admin-token: <token>'
curl -X POST ${BASE}/admin/keys/serper/<keyId>/test        -H 'content-type: application/json' -d '{}' -H 'x-admin-token: <token>'
curl -X DELETE ${BASE}/admin/keys/serper/<keyId> -H 'x-admin-token: <token>'`;

const ERR_RESPONSE = `{
  "error": "all_providers_failed",
  "message": "所有搜索供应商均不可用",
  "attempts": [
    { "provider": "serper", "ok": false, "code": "keyInvalid", "message": "Serper 密钥无效: Unauthorized.", "tookMs": 120 },
    { "provider": "exa", "ok": false, "code": "no_key_available", "message": "所有密钥均处于冷却/隔离状态或已达速率上限", "tookMs": 0 }
  ]
}`;

export default function ApiDocs() {
  return (
    <>
      <section className="card">
        <h3>接口约定</h3>
        <p className="sub">
          基础地址：<span className="mono">{BASE}</span>（随当前访问地址自动变化）
        </p>

        <table>
          <tbody>
            <tr>
              <td style={{ width: 150 }}>认证方式</td>
              <td>
                搜索接口：<span className="mono">x-api-key: sh_xxx</span>，或{' '}
                <span className="mono">Authorization: Bearer sh_xxx</span>
                <br />
                管理接口：<span className="mono">x-admin-token: &lt;登录令牌&gt;</span>
                ，或环境变量里的主令牌
              </td>
            </tr>
            <tr>
              <td>请求格式</td>
              <td>
                JSON。<b>所有 POST / PATCH 都必须带</b>{' '}
                <span className="mono">content-type: application/json</span> 和请求体，无请求体请传{' '}
                <span className="mono">{'{}'}</span>，否则 Fastify 会返回 415 / 400
              </td>
            </tr>
            <tr>
              <td>时间格式</td>
              <td>
                ISO 8601（<span className="mono">publishedAt</span> 由各家的「3 days ago」等写法归一化而来）
              </td>
            </tr>
            <tr>
              <td>分页</td>
              <td>
                <span className="mono">page</span> 从 1 开始，<span className="mono">pageSize</span>{' '}
                上限 50；Exa 不支持翻页，<span className="mono">page &gt; 1</span> 会被记入{' '}
                <span className="mono">meta.ignoredParams</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>接口总览</h3>
        <table>
          <thead>
            <tr>
              <th>方法</th>
              <th>路径</th>
              <th>认证</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>GET</td>
              <td className="mono">/api/health</td>
              <td>公开</td>
              <td>健康检查，返回各供应商熔断状态与可用密钥数</td>
            </tr>
            <tr>
              <td>POST / GET</td>
              <td className="mono">/api/search</td>
              <td>API Key</td>
              <td>统一搜索接口（对外主接口）</td>
            </tr>
            <tr>
              <td>POST</td>
              <td className="mono">/api/admin/login</td>
              <td>密码</td>
              <td>管理后台登录，返回会话令牌</td>
            </tr>
            <tr>
              <td>GET</td>
              <td className="mono">/api/admin/state</td>
              <td>登录</td>
              <td>供应商、密钥、统计、最近日志的全量状态</td>
            </tr>
            <tr>
              <td>POST</td>
              <td className="mono">/api/admin/search</td>
              <td>登录</td>
              <td>调试台搜索，逻辑与 /api/search 一致，免 API Key</td>
            </tr>
            <tr>
              <td>POST</td>
              <td className="mono">/api/admin/providers/:id</td>
              <td>登录</td>
              <td>修改供应商配置（启停、优先级、超时、熔断参数）</td>
            </tr>
            <tr>
              <td>POST</td>
              <td className="mono">/api/admin/keys</td>
              <td>登录</td>
              <td>添加供应商密钥</td>
            </tr>
            <tr>
              <td>PATCH</td>
              <td className="mono">/api/admin/keys/:providerId/:keyId</td>
              <td>登录</td>
              <td>改标签 / 启停 / QPS / 日配额 / 密钥内容</td>
            </tr>
            <tr>
              <td>DELETE</td>
              <td className="mono">/api/admin/keys/:providerId/:keyId</td>
              <td>登录</td>
              <td>删除供应商密钥</td>
            </tr>
            <tr>
              <td>POST</td>
              <td className="mono">/api/admin/keys/:providerId/:keyId/reset</td>
              <td>登录</td>
              <td>解除冷却 / 隔离，立即恢复可用</td>
            </tr>
            <tr>
              <td>POST</td>
              <td className="mono">/api/admin/keys/:providerId/:keyId/reset-usage</td>
              <td>登录</td>
              <td>清零日 / 月 / 总用量计数并解除隔离</td>
            </tr>
            <tr>
              <td>POST</td>
              <td className="mono">/api/admin/keys/:providerId/:keyId/test</td>
              <td>登录</td>
              <td>用该密钥真实打一次请求，验证连通性</td>
            </tr>
            <tr>
              <td>GET / POST</td>
              <td className="mono">/api/admin/api-keys</td>
              <td>登录</td>
              <td>列出 / 创建接入用 API Key</td>
            </tr>
            <tr>
              <td>POST / DELETE</td>
              <td className="mono">/api/admin/api-keys/:id/revoke</td>
              <td>登录</td>
              <td>吊销（POST）/ 删除记录（DELETE）</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>1. 统一搜索接口　POST /api/search</h3>
        <p className="sub">对外主接口，调用方只需要认这一份协议</p>

        <table>
          <thead>
            <tr>
              <th style={{ width: 120 }}>字段</th>
              <th style={{ width: 90 }}>类型</th>
              <th style={{ width: 70 }}>必填</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">q</td>
              <td>string</td>
              <td>是</td>
              <td>检索词，1–2048 字符</td>
            </tr>
            <tr>
              <td className="mono">page</td>
              <td>number</td>
              <td>否</td>
              <td>页码，从 1 开始，最大 50。Exa 不支持，会被忽略</td>
            </tr>
            <tr>
              <td className="mono">pageSize</td>
              <td>number</td>
              <td>否</td>
              <td>每页条数，1–50，默认 10</td>
            </tr>
            <tr>
              <td className="mono">timeRange</td>
              <td>enum</td>
              <td>否</td>
              <td>
                <span className="mono">day | week | month | year</span>，Serper 转 tbs、Exa 转发布时间起点
              </td>
            </tr>
            <tr>
              <td className="mono">site</td>
              <td>string</td>
              <td>否</td>
              <td>站内限定，如 github.com。Serper 走 site: 语法，Exa 走 includeDomains</td>
            </tr>
            <tr>
              <td className="mono">country</td>
              <td>string</td>
              <td>否</td>
              <td>ISO 3166-1 alpha-2，如 us / cn。仅 Serper 支持（gl）</td>
            </tr>
            <tr>
              <td className="mono">lang</td>
              <td>string</td>
              <td>否</td>
              <td>语言，如 en / zh。仅 Serper 支持（hl）</td>
            </tr>
            <tr>
              <td className="mono">safeSearch</td>
              <td>enum</td>
              <td>否</td>
              <td>off / moderate / strict，当前两家都未适配，会被忽略</td>
            </tr>
            <tr>
              <td className="mono">providerId</td>
              <td>string</td>
              <td>否</td>
              <td>强制指定供应商（serper / exa），留空则按优先级自动选择</td>
            </tr>
          </tbody>
        </table>

        <p className="sub" style={{ marginTop: 16 }}>
          请求示例
        </p>
        <CodeBlock code={SEARCH_CURL} />
        <p className="sub" style={{ marginTop: 12 }}>
          也支持 GET（参数放 query string）
        </p>
        <CodeBlock code={SEARCH_GET} />
        <p className="sub" style={{ marginTop: 12 }}>
          浏览器 / Node 调用
        </p>
        <CodeBlock code={SEARCH_JS} />
        <p className="sub" style={{ marginTop: 12 }}>
          响应结构
        </p>
        <CodeBlock code={SEARCH_RESPONSE} />

        <table style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th style={{ width: 160 }}>响应字段</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">results[]</td>
              <td>统一后的结果：title / url / snippet / publishedAt? / score? / provider</td>
            </tr>
            <tr>
              <td className="mono">meta.provider</td>
              <td>实际命中的供应商</td>
            </tr>
            <tr>
              <td className="mono">meta.keyId</td>
              <td>实际使用的供应商密钥 id（不含密钥内容）</td>
            </tr>
            <tr>
              <td className="mono">meta.degraded</td>
              <td>
                是否发生降级；为 true 时 <span className="mono">switchedFrom</span> 表示原本想用的供应商
              </td>
            </tr>
            <tr>
              <td className="mono">meta.ignoredParams</td>
              <td>该供应商不支持、被静默忽略的参数</td>
            </tr>
            <tr>
              <td className="mono">meta.attempts[]</td>
              <td>本次调用的完整链路：试过哪些密钥/供应商、成功与否、耗时</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>2. 健康检查　GET /api/health</h3>
        <p className="sub">公开接口，不含任何密钥信息，适合做探活</p>
        <CodeBlock code={`curl ${BASE}/health`} />
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th style={{ width: 160 }}>字段</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">providers[].breaker</td>
              <td>closed（正常）/ open（已熔断）/ half-open（探测中）</td>
            </tr>
            <tr>
              <td className="mono">providers[].keySummary</td>
              <td>total / active / cooling / quarantined 四类密钥数量</td>
            </tr>
            <tr>
              <td className="mono">providers[].stats</td>
              <td>累计调用、成功、失败、最近错误</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>3. 管理接口</h3>
        <p className="sub">
          先登录拿令牌，令牌默认 8 小时有效；改密码后旧令牌立即失效
        </p>
        <CodeBlock code={LOGIN_CURL} />
        <CodeBlock code={ADMIN_CURL} />

        <p className="sub" style={{ marginTop: 12 }}>
          创建接入用 API Key（明文只返回这一次）
        </p>
        <CodeBlock code={APIKEY_CURL} />

        <p className="sub" style={{ marginTop: 12 }}>
          调整供应商（示例：把 exa 提为主力）
        </p>
        <CodeBlock code={PROVIDER_CURL} />

        <p className="sub" style={{ marginTop: 12 }}>
          供应商密钥管理
        </p>
        <CodeBlock code={KEY_CURL} />
      </section>

      <section className="card">
        <h3>4. 错误码</h3>
        <table>
          <thead>
            <tr>
              <th style={{ width: 70 }}>HTTP</th>
              <th style={{ width: 180 }}>error</th>
              <th>含义与处理</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">400</td>
              <td className="mono">bad_request</td>
              <td>参数校验失败（如 q 为空、pageSize 超 50）；或所有供应商都拒绝了请求</td>
            </tr>
            <tr>
              <td className="mono">401</td>
              <td className="mono">unauthorized</td>
              <td>缺少 / 无效 / 已吊销的 API Key，或管理令牌无效、登录已过期</td>
            </tr>
            <tr>
              <td className="mono">404</td>
              <td className="mono">not_found</td>
              <td>供应商或密钥不存在</td>
            </tr>
            <tr>
              <td className="mono">415</td>
              <td className="mono">—</td>
              <td>POST 未带 content-type，补上即可</td>
            </tr>
            <tr>
              <td className="mono">502</td>
              <td className="mono">all_providers_failed</td>
              <td>所有供应商都不可用，看 attempts 定位原因</td>
            </tr>
            <tr>
              <td className="mono">500</td>
              <td className="mono">internal_error</td>
              <td>服务内部异常</td>
            </tr>
          </tbody>
        </table>

        <p className="sub" style={{ marginTop: 16 }}>
          attempts[].code 故障分类（决定系统换密钥还是换供应商）
        </p>
        <table>
          <thead>
            <tr>
              <th style={{ width: 190 }}>code</th>
              <th style={{ width: 130 }}>触发</th>
              <th>系统动作</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">keyInvalid</td>
              <td>401 / 403</td>
              <td>该密钥隔离 6 小时，立即换下一个密钥</td>
            </tr>
            <tr>
              <td className="mono">keyRateLimited</td>
              <td>429</td>
              <td>按 Retry-After 冷却（缺省 60 秒），换下一个密钥</td>
            </tr>
            <tr>
              <td className="mono">keyQuotaExhausted</td>
              <td>402 / 额度提示</td>
              <td>冷却到次日 UTC 0 点，换下一个密钥</td>
            </tr>
            <tr>
              <td className="mono">providerUnavailable</td>
              <td>5xx / 超时</td>
              <td>不惩罚密钥，计入熔断计数，切换供应商</td>
            </tr>
            <tr>
              <td className="mono">badRequest</td>
              <td>400</td>
              <td>重试无意义，直接换下一家供应商</td>
            </tr>
            <tr>
              <td className="mono">no_key_available</td>
              <td>密钥耗尽</td>
              <td>该供应商所有密钥都在冷却/隔离或已达速率上限</td>
            </tr>
            <tr>
              <td className="mono">circuit_open</td>
              <td>熔断生效</td>
              <td>该供应商被跳过，冷却结束后半开探测</td>
            </tr>
          </tbody>
        </table>

        <p className="sub" style={{ marginTop: 16 }}>
          502 响应示例
        </p>
        <CodeBlock code={ERR_RESPONSE} />
      </section>
    </>
  );
}
