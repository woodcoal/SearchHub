import { useState } from 'react';
import { api, type SearchResponse, type StateSnapshot } from '../api';

export default function Playground({ state }: { state: StateSnapshot }) {
  const [q, setQ] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [country, setCountry] = useState('');
  const [lang, setLang] = useState('');
  const [timeRange, setTimeRange] = useState('');
  const [site, setSite] = useState('');
  const [providerId, setProviderId] = useState('');
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function run() {
    if (!q.trim()) {
      setError('请输入检索词');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const body: Record<string, unknown> = { q: q.trim(), pageSize };
      if (country) body.country = country;
      if (lang) body.lang = lang;
      if (timeRange) body.timeRange = timeRange;
      if (site) body.site = site;
      if (providerId) body.providerId = providerId;
      setResult(await api.search(body));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="card">
        <h3>统一协议调试</h3>
        <p className="sub">
          走与生产完全相同的链路：密钥轮换 → 失败切换 → 供应商降级。响应里可以看到实际命中的供应商与密钥。
        </p>

        <div className="row">
          <input
            value={q}
            placeholder="检索词"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run();
            }}
            style={{ flex: '3 1 320px' }}
          />
          <select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            title="留空=自动按优先级；也可强制指定某一供应商"
          >
            <option value="">自动（按优先级）</option>
            {state.providers.map((p) => (
              <option key={p.id} value={p.id}>
                强制 {p.id}
              </option>
            ))}
          </select>
          <button className="btn primary" disabled={loading} onClick={() => void run()}>
            {loading ? '搜索中…' : '搜索'}
          </button>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <input
            type="number"
            min={1}
            max={50}
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            style={{ width: 100 }}
            title="每页条数"
          />
          <input
            placeholder="国家，如 us"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            style={{ width: 130 }}
          />
          <input
            placeholder="语言，如 en"
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            style={{ width: 130 }}
          />
          <input
            placeholder="站内限定，如 github.com"
            value={site}
            onChange={(e) => setSite(e.target.value)}
            style={{ flex: '1 1 200px' }}
          />
          <select value={timeRange} onChange={(e) => setTimeRange(e.target.value)}>
            <option value="">不限时间</option>
            <option value="day">最近一天</option>
            <option value="week">最近一周</option>
            <option value="month">最近一月</option>
            <option value="year">最近一年</option>
          </select>
        </div>

        {error && <div className="error-box" style={{ marginTop: 14, marginBottom: 0 }}>{error}</div>}
      </section>

      {result && (
        <>
          <section className="card">
            <div className="spread">
              <h3>调用链路</h3>
              <div className="row">
                <span className="badge accent">命中 {result.meta.provider}</span>
                <span className={`badge ${result.meta.degraded ? 'warn' : 'ok'}`}>
                  {result.meta.degraded ? `已降级（原 ${result.meta.switchedFrom}）` : '未降级'}
                </span>
                <span className="badge">{result.meta.tookMs}ms</span>
                <span className="badge mono">key {result.meta.keyId.slice(0, 8)}</span>
              </div>
            </div>

            {result.meta.ignoredParams.length > 0 && (
              <div className="notice" style={{ marginTop: 12, marginBottom: 0 }}>
                该供应商不支持以下参数，已静默忽略：{result.meta.ignoredParams.join('、')}
              </div>
            )}

            <div className="timeline" style={{ marginTop: 12 }}>
              {result.meta.attempts.map((item, index) => (
                <div
                  key={`${item.at}-${index}`}
                  className={`timeline-item ${item.ok ? 'ok' : 'fail'}`}
                >
                  <span className="badge accent">{item.provider}</span>
                  <span className="mono muted">{item.keyId ? item.keyId.slice(0, 8) : '—'}</span>
                  <span>{item.ok ? '成功' : item.code}</span>
                  <span className="muted">{item.message ?? ''}</span>
                  <span className="mono muted" style={{ marginLeft: 'auto' }}>
                    {item.tookMs}ms
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h3>结果（{result.results.length} 条）</h3>
            {result.results.length === 0 ? (
              <div className="empty">没有返回结果</div>
            ) : (
              result.results.map((item, index) => (
                <div className="result" key={`${item.url}-${index}`}>
                  <a href={item.url} target="_blank" rel="noreferrer">
                    {item.title}
                  </a>
                  <div className="url">{item.url}</div>
                  {item.snippet && <p>{item.snippet}</p>}
                  <div className="row" style={{ marginTop: 6 }}>
                    <span className="badge">{item.provider}</span>
                    {item.publishedAt && (
                      <span className="badge muted">
                        {new Date(item.publishedAt).toLocaleDateString()}
                      </span>
                    )}
                    {typeof item.score === 'number' && (
                      <span className="badge mono">score {item.score.toFixed(3)}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </>
  );
}
