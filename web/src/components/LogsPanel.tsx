import { useCallback, useEffect, useState } from 'react';
import { api, type CallLogEntry, type LogEntry, type LogsResponse } from '../api';
import Icon from './Icon';
import { toastErr } from './Toast';

const LEVEL_NAME: Record<number, { text: string; tone: string }> = {
  10: { text: 'TRACE', tone: '' },
  20: { text: 'DEBUG', tone: '' },
  30: { text: 'INFO', tone: 'ok' },
  40: { text: 'WARN', tone: 'warn' },
  50: { text: 'ERROR', tone: 'danger' },
  60: { text: 'FATAL', tone: 'danger' },
};

function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function toMillis(entry: LogEntry): number | null {
  const raw = entry.time ?? entry.at;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  // pino 默认是 epoch 毫秒；兼容可能是秒的情况
  return raw < 1e11 ? raw * 1000 : raw;
}

function formatTime(entry: LogEntry): string {
  const ms = toMillis(entry);
  return ms ? new Date(ms).toLocaleString() : '—';
}

function levelOf(entry: LogEntry) {
  const value = typeof entry.level === 'number' ? entry.level : 30;
  return LEVEL_NAME[value] ?? { text: String(value), tone: '' };
}

function detailOf(entry: LogEntry): string {
  const { level, time, at, msg, event, ...rest } = entry;
  return JSON.stringify(rest, null, 2);
}

export default function LogsPanel() {
  const [date, setDate] = useState(today());
  const [level, setLevel] = useState('');
  const [onlySearch, setOnlySearch] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [data, setData] = useState<LogsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(false);
  const [calls, setCalls] = useState<{
    file: string;
    limit: number;
    total: number;
    entries: CallLogEntry[];
  } | null>(null);
  const [callsLimit, setCallsLimit] = useState(100);

  const loadCalls = useCallback(async (limit: number) => {
    try {
      setCalls(await api.calls(limit));
    } catch (err) {
      toastErr((err as Error).message);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.logs({ date, level, onlySearch, keyword, limit: 300 }));
    } catch (err) {
      toastErr((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [date, level, onlySearch, keyword]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadCalls(callsLimit);
  }, [loadCalls, callsLimit]);

  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => {
      void load();
      void loadCalls(callsLimit);
    }, 5000);
    return () => clearInterval(timer);
  }, [auto, load, loadCalls, callsLimit]);

  return (
    <>
      <section className="card">
        <div className="spread">
          <div>
            <h3>
              <Icon name="key" size={15} /> 调用记录（持久化）
            </h3>
            <p className="sub">
              每次密钥 / 供应商尝试的明细，落盘在 <span className="mono">{calls?.file ?? '…'}</span>
              ，重启后自动加载，最多保留最近 1000 条
            </p>
          </div>
          <div className="row">
            <select
              value={callsLimit}
              onChange={(e) => setCallsLimit(Number(e.target.value))}
              style={{ width: 130 }}
            >
              <option value={50}>最近 50 条</option>
              <option value={200}>最近 200 条</option>
              <option value={1000}>最近 1000 条</option>
            </select>
            <button className="btn sm icon-btn" onClick={() => void loadCalls(callsLimit)}>
              <Icon name="refresh" />
              <span className="btn-label">刷新</span>
            </button>
          </div>
        </div>

        <table className="table-stack">
          <thead>
            <tr>
              <th style={{ width: 165 }}>时间</th>
              <th style={{ width: 100 }}>供应商</th>
              <th style={{ width: 90 }}>密钥</th>
              <th style={{ width: 80 }}>结果</th>
              <th style={{ width: 85 }}>耗时</th>
              <th>错误码 / 消息</th>
            </tr>
          </thead>
          <tbody>
            {(calls?.entries ?? []).map((entry, index) => (
              <tr key={`${entry.at}-${index}`}>
                <td data-label="时间" className="mono muted">
                  {new Date(entry.at).toLocaleString()}
                </td>
                <td data-label="供应商">{entry.provider}</td>
                <td data-label="密钥" className="mono muted">
                  {entry.keyId ? String(entry.keyId).slice(0, 8) : '—'}
                </td>
                <td data-label="结果">
                  <span className={`badge ${entry.ok ? 'ok' : 'danger'}`}>
                    {entry.ok ? '成功' : '失败'}
                  </span>
                </td>
                <td data-label="耗时" className="mono">
                  {entry.tookMs}ms
                </td>
                <td data-label="错误码 / 消息" className="muted">
                  <span className="ellipsis" title={`${entry.code ?? ''} ${entry.message ?? ''}`.trim()}>
                    {entry.code ? `${entry.code} ` : ''}
                    {entry.message ?? '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {(calls?.entries ?? []).length === 0 && (
          <div className="empty">
            暂无调用记录（共 {calls?.total ?? 0} 条）——每次密钥尝试都会记录在这里，重启后依然保留
          </div>
        )}
      </section>

      <section className="card">
        <div className="spread">
          <div>
            <h3>
              <Icon name="book" size={15} /> 运行日志
            </h3>
            <p className="sub">
              按天读取 <span className="mono">{data?.dir ?? '日志目录'}</span> 下的日志文件，默认只看搜索事件
            </p>
          </div>
          <button className="btn sm icon-btn" disabled={loading} onClick={() => void load()}>
            <Icon name="refresh" className={loading ? 'spin' : undefined} />
            <span className="btn-label">刷新</span>
          </button>
        </div>

        <div className="row log-filters">
          <input
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value || today())}
            style={{ width: 150 }}
          />
          <select value={level} onChange={(e) => setLevel(e.target.value)} style={{ width: 120 }}>
            <option value="">全部级别</option>
            <option value="info">INFO 及以上</option>
            <option value="warn">WARN 及以上</option>
            <option value="error">ERROR 及以上</option>
          </select>
          <input
            placeholder="关键词（检索词 / 供应商 / 消息）"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ flex: '1 1 220px' }}
          />
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={onlySearch}
              onChange={(e) => setOnlySearch(e.target.checked)}
            />
            <span className="muted">仅搜索事件</span>
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            <span className="muted">自动刷新</span>
          </label>
        </div>

        {data && !data.exists ? (
          <div className="empty">
            {data.date} 没有日志文件
            {data.date === today() ? '（还没有产生日志，发一次搜索即可）' : ''}
          </div>
        ) : (
          <table className="table-stack">
            <thead>
              <tr>
                <th style={{ width: 170 }}>时间</th>
                <th style={{ width: 80 }}>级别</th>
                <th>内容</th>
                <th style={{ width: 150 }}>结果 / 耗时</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {(data?.entries ?? []).map((entry, index) => {
                const tone = levelOf(entry);
                const isSearch = entry.event === 'search';
                const attempts = typeof entry.attempts === 'number' ? entry.attempts : undefined;
                return (
                  <tr key={`${entry.time ?? entry.at}-${index}`}>
                    <td data-label="时间" className="mono muted">
                      {formatTime(entry)}
                    </td>
                    <td data-label="级别">
                      <span className={`badge ${tone.tone}`}>{tone.text}</span>
                    </td>
                    <td data-label="内容">
                      {isSearch ? (
                        <div className="log-search">
                          <div className="log-query" title={entry.q}>
                            {entry.ok === false ? '✕ ' : '✓ '}
                            {entry.q}
                          </div>
                          <div className="muted log-meta">
                            {entry.provider ? `命中 ${entry.provider}` : '未命中供应商'}
                            {entry.requestedProvider ? ` · 指定 ${entry.requestedProvider}` : ''}
                            {entry.keyId ? ` · key ${String(entry.keyId).slice(0, 8)}` : ''}
                            {entry.degraded ? ' · 已降级' : ''}
                            {entry.source ? ` · 来自 ${entry.source}` : ''}
                          </div>
                        </div>
                      ) : (
                        <div className="log-query" title={entry.msg}>
                          {entry.msg ?? '(无消息)'}
                        </div>
                      )}
                    </td>
                    <td data-label="结果 / 耗时" className="mono">
                      {isSearch
                        ? `${entry.results ?? 0} 条 / ${entry.tookMs ?? 0}ms${attempts && attempts > 1 ? ` · ${attempts} 次尝试` : ''}`
                        : '—'}
                    </td>
                    <td data-label="">
                      <details className="menu">
                        <summary className="btn sm icon-btn" title="查看原始记录">
                          <Icon name="more" />
                        </summary>
                        <div className="menu-panel log-detail">
                          <pre className="code-block">{detailOf(entry)}</pre>
                        </div>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {(data?.entries ?? []).length === 0 && data?.exists && (
          <div className="empty">当前过滤条件下没有日志</div>
        )}
      </section>

      {data && data.files.length > 0 && (
        <section className="card">
          <h3>日志文件</h3>
          <p className="sub">
            保留 {data.retentionDays > 0 ? `${data.retentionDays} 天` : '永久'}；当前文件共 {data.total} 行
            {data.skipped > 0 ? `（${data.skipped} 行非 JSON 已跳过）` : ''}
          </p>
          <table className="table-stack">
            <thead>
              <tr>
                <th>文件</th>
                <th style={{ width: 120 }}>大小</th>
                <th style={{ width: 100 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.files
                .slice()
                .reverse()
                .map((file) => {
                  const fileDate = file.name.replace('searchhub-', '').replace('.log', '');
                  return (
                    <tr key={file.name}>
                      <td data-label="文件" className="mono">
                        {file.name}
                      </td>
                      <td data-label="大小" className="mono">
                        {(file.size / 1024).toFixed(1)} KB
                      </td>
                      <td data-label="操作">
                        <button className="btn sm" onClick={() => setDate(fileDate)}>
                          查看
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
