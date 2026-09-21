import { useCallback, useEffect, useState } from 'react';
import { api, type UsageBucket, type UsageSnapshot } from '../api';
import Icon from './Icon';
import { toastErr } from './Toast';

function rate(calls: number, success: number): string {
  if (calls === 0) return '—';
  return `${Math.round((success / calls) * 100)}%`;
}

function avg(counter: { calls: number; totalTookMs: number }): string {
  if (counter.calls === 0) return '—';
  return `${Math.round(counter.totalTookMs / counter.calls)}ms`;
}

function time(ts: number | null): string {
  return ts ? new Date(ts).toLocaleString() : '—';
}

function BarChart({ data, unit }: { data: UsageBucket[]; unit: 'hour' | 'day' }) {
  const max = Math.max(1, ...data.map((item) => item.calls));

  return (
    <div className="chart">
      {data.map((item) => {
        const label = unit === 'hour' ? item.at.slice(-2) + ':00' : item.at.slice(5);
        const failedRatio = item.calls > 0 ? (item.failed / item.calls) * 100 : 0;
        return (
          <div
            key={item.at}
            className="chart-col"
            title={`${item.at}\n调用 ${item.calls} · 成功 ${item.success} · 失败 ${item.failed}\n平均 ${item.avgTookMs}ms`}
          >
            <span className="chart-count">{item.calls > 0 ? item.calls : ''}</span>
            <div className="chart-bar" style={{ height: `${(item.calls / max) * 100}%` }}>
              {failedRatio > 0 && (
                <span className="chart-failed" style={{ height: `${failedRatio}%` }} />
              )}
            </div>
            <span className="chart-label">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function UsagePanel() {
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsage(await api.usage());
    } catch (err) {
      toastErr((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!usage) return <div className="spinner">加载中…</div>;

  const { totals } = usage;

  return (
    <>
      <section className="card">
        <div className="spread">
          <div>
            <h3>
              <Icon name="chart" size={15} /> 调用用量
            </h3>
            <p className="sub">
              按「尝试次数」统计（一次搜索可能包含换密钥 / 换供应商的多轮尝试），
              失败包含限流、超时、密钥失效以及「无可用密钥」；数据为进程内累计，重启清零
            </p>
          </div>
          <button className="btn sm icon-btn" disabled={loading} onClick={() => void load()}>
            <Icon name="refresh" className={loading ? 'spin' : undefined} />
            <span className="btn-label">刷新</span>
          </button>
        </div>

        <div className="metrics">
          <div className="metric">
            <div className="label">总调用</div>
            <div className="value">{totals.calls}</div>
          </div>
          <div className="metric">
            <div className="label">成功</div>
            <div className="value">{totals.success}</div>
          </div>
          <div className="metric">
            <div className="label">失败</div>
            <div className="value">{totals.failed}</div>
          </div>
          <div className="metric">
            <div className="label">成功率</div>
            <div className="value">{rate(totals.calls, totals.success)}</div>
          </div>
          <div className="metric">
            <div className="label">平均耗时</div>
            <div className="value">{totals.avgTookMs ? `${totals.avgTookMs}ms` : '—'}</div>
          </div>
        </div>
      </section>

      {totals.calls === 0 ? (
        <section className="card">
          <div className="empty">
            暂无调用数据。可到「搜索调试」发一次请求，或通过 API / MCP 调用后回到这里查看。
          </div>
        </section>
      ) : (
        <>
          <div className="grid-2">
            <section className="card">
              <h3>最近 24 小时</h3>
              <p className="sub">柱高表示调用次数，红色部分为失败</p>
              <BarChart data={usage.hourly} unit="hour" />
            </section>

            <section className="card">
              <h3>最近 14 天</h3>
              <p className="sub">按天聚合，用于观察长期趋势</p>
              <BarChart data={usage.daily} unit="day" />
            </section>
          </div>

          <section className="card">
            <h3>分供应商</h3>
            <p className="sub">命中次数与稳定性，可据此调整优先级</p>
            <table className="table-stack">
              <thead>
                <tr>
                  <th>供应商</th>
                  <th>调用</th>
                  <th>成功</th>
                  <th>失败</th>
                  <th>成功率</th>
                  <th>平均耗时</th>
                  <th>最近成功</th>
                  <th>最近错误</th>
                </tr>
              </thead>
              <tbody>
                {usage.providers.map((item) => (
                  <tr key={item.id}>
                    <td data-label="供应商" className="mono">
                      {item.id}
                    </td>
                    <td data-label="调用" className="mono">
                      {item.calls}
                    </td>
                    <td data-label="成功" className="mono">
                      {item.success}
                    </td>
                    <td data-label="失败" className="mono">
                      {item.failed}
                    </td>
                    <td data-label="成功率" className="mono">
                      {rate(item.calls, item.success)}
                    </td>
                    <td data-label="平均耗时" className="mono">
                      {avg(item)}
                    </td>
                    <td data-label="最近成功" className="muted">
                      {time(item.lastOkAt)}
                    </td>
                    <td data-label="最近错误" className="muted key-error">
                      {item.lastError ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card">
            <h3>分密钥</h3>
            <p className="sub">每把供应商密钥的使用情况，便于发现「某把 key 一直没被用到」或「某把 key 频繁失败」</p>
            <table className="table-stack">
              <thead>
                <tr>
                  <th>密钥</th>
                  <th>状态</th>
                  <th>调用</th>
                  <th>成功</th>
                  <th>失败</th>
                  <th>成功率</th>
                  <th>平均耗时</th>
                  <th>最近使用</th>
                  <th>最近错误</th>
                </tr>
              </thead>
              <tbody>
                {usage.keys.map((item) => (
                  <tr key={`${item.providerId}:${item.keyId}`}>
                    <td data-label="密钥">
                      <div className="key-label">{item.label}</div>
                      <div className="mono muted">
                        {item.providerId} · {item.hint || item.keyId.slice(0, 8)}
                      </div>
                    </td>
                    <td data-label="状态">
                      <span className={`badge ${item.enabled ? 'ok' : ''}`}>
                        {item.enabled ? '启用' : '停用'}
                      </span>
                    </td>
                    <td data-label="调用" className="mono">
                      {item.calls}
                    </td>
                    <td data-label="成功" className="mono">
                      {item.success}
                    </td>
                    <td data-label="失败" className="mono">
                      {item.failed}
                    </td>
                    <td data-label="成功率" className="mono">
                      {rate(item.calls, item.success)}
                    </td>
                    <td data-label="平均耗时" className="mono">
                      {avg(item)}
                    </td>
                    <td data-label="最近使用" className="muted">
                      {time(item.lastUsedAt)}
                    </td>
                    <td data-label="最近错误" className="muted key-error">
                      {item.lastError ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}
