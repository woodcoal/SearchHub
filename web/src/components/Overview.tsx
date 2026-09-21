import type { ProviderView, StateSnapshot } from '../api';

const KEY_STATE_LABEL: Record<string, string> = {
  active: '可用',
  cooling: '冷却中',
  quarantined: '已隔离',
};

const BREAKER_LABEL: Record<string, { text: string; tone: string }> = {
  closed: { text: '正常', tone: 'ok' },
  'half-open': { text: '半开探测', tone: 'warn' },
  open: { text: '已熔断', tone: 'danger' },
};

export default function Overview({ state }: { state: StateSnapshot }) {
  return (
    <>
      <div className="grid-2">
        {state.providers.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} />
        ))}
      </div>

      <section className="card">
        <h3>最近调用日志</h3>
        <p className="sub">展示最近 30 次尝试，包含每次切换密钥 / 切换供应商的原因</p>
        {state.log.length === 0 ? (
          <div className="empty">暂无调用记录，可到「搜索调试」发一次请求</div>
        ) : (
          <div className="timeline">
            {state.log.map((item, index) => (
              <div key={`${item.at}-${index}`} className={`timeline-item ${item.ok ? 'ok' : 'fail'}`}>
                <span className="mono muted">{new Date(item.at).toLocaleTimeString()}</span>
                <span className="badge accent">{item.provider}</span>
                <span>{item.ok ? '成功' : `${item.code ?? '失败'}`}</span>
                <span className="muted">{item.message ?? ''}</span>
                <span className="mono muted" style={{ marginLeft: 'auto' }}>
                  {item.tookMs}ms
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function ProviderCard({ provider }: { provider: ProviderView }) {
  const { stats, keys, settings, breaker } = provider;
  const successRate = stats.calls > 0 ? Math.round((stats.success / stats.calls) * 100) : null;
  const active = keys.filter((k) => k.enabled && k.state === 'active').length;
  const cooling = keys.filter((k) => k.state === 'cooling').length;
  const quarantined = keys.filter((k) => k.state === 'quarantined').length;
  const breakerInfo = BREAKER_LABEL[breaker.state] ?? BREAKER_LABEL.closed!;

  return (
    <section className="card">
      <div className="spread">
        <div>
          <h3>{provider.displayName}</h3>
          <p className="sub mono">{provider.id}</p>
        </div>
        <div className="row">
          {settings.enabled ? (
            <span className="badge ok">已启用</span>
          ) : (
            <span className="badge">已停用</span>
          )}
          <span className={`badge ${breakerInfo.tone}`}>{breakerInfo.text}</span>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 4 }}>
        <span className="badge">优先级 {settings.priority}</span>
        <span className="badge">超时 {settings.timeoutMs}ms</span>
        <span className="badge">单供应商最多试 {settings.maxKeyAttempts} 个密钥</span>
        {!provider.supportsPaging && <span className="badge warn">不支持翻页</span>}
      </div>

      <div className="row" style={{ marginBottom: 6 }}>
        {provider.capabilities.map((cap) => (
          <span key={cap} className="badge accent">
            {cap}
          </span>
        ))}
      </div>

      <div className="metrics">
        <div className="metric">
          <div className="label">调用次数</div>
          <div className="value">{stats.calls}</div>
        </div>
        <div className="metric">
          <div className="label">成功率</div>
          <div className="value">{successRate === null ? '—' : `${successRate}%`}</div>
        </div>
        <div className="metric">
          <div className="label">可用密钥</div>
          <div className="value">{active}</div>
        </div>
        <div className="metric">
          <div className="label">冷却 / 隔离</div>
          <div className="value">
            {cooling} / {quarantined}
          </div>
        </div>
      </div>

      {keys.length === 0 ? (
        <div className="empty">尚未配置密钥，请到「密钥管理」添加</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>密钥</th>
              <th>状态</th>
              <th>今日用量</th>
              <th>最近错误</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id}>
                <td>
                  <div>{key.label}</div>
                  <div className="mono muted">{key.hint}</div>
                </td>
                <td>
                  <span
                    className={`badge ${
                      key.state === 'active' ? (key.enabled ? 'ok' : '') : 'danger'
                    }`}
                  >
                    {key.enabled ? KEY_STATE_LABEL[key.state] : '已禁用'}
                  </span>
                </td>
                <td className="mono">
                  {key.usedToday}
                  {key.dailyQuota ? ` / ${key.dailyQuota}` : ''}
                </td>
                <td className="muted" style={{ maxWidth: 180 }}>
                  {key.lastError ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {stats.lastError && (
        <div className="error-box" style={{ marginTop: 12, marginBottom: 0 }}>
          最近失败：{stats.lastError}
        </div>
      )}
    </section>
  );
}
