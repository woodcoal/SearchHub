import { useState } from 'react';
import { api, type KeyView, type ProviderView, type StateSnapshot } from '../api';

const STATE_TONE: Record<string, string> = { active: 'ok', cooling: 'warn', quarantined: 'danger' };
const STATE_LABEL: Record<string, string> = {
  active: '可用',
  cooling: '冷却中',
  quarantined: '已隔离',
};

export default function KeysPanel({
  state,
  onRefresh,
}: {
  state: StateSnapshot;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  async function run(action: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(action);
    setNotice('');
    try {
      await fn();
      if (success) setNotice(success);
      await onRefresh();
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      {notice && <div className="notice">{notice}</div>}
      {state.providers.map((provider) => (
        <section className="card" key={provider.id}>
          <div className="spread">
            <div>
              <h3>{provider.displayName}</h3>
              <p className="sub">
                共 {provider.keys.length} 个密钥 · 失效自动切换下一个，全部失效则切换供应商
              </p>
            </div>
            <a className="badge" href={provider.docsUrl} target="_blank" rel="noreferrer">
              官方文档
            </a>
          </div>

          {provider.keys.length === 0 ? (
            <div className="empty">暂无密钥</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>标签 / 摘要</th>
                  <th>状态</th>
                  <th>QPS</th>
                  <th>日配额</th>
                  <th>月配额</th>
                  <th>总配额</th>
                  <th style={{ width: 260 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {provider.keys.map((key) => (
                  <>
                  <tr key={key.id}>
                    <td>
                      <div>{key.label}</div>
                      <div className="mono muted">{key.hint}</div>
                      {key.lastError && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {key.lastError}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${key.enabled ? STATE_TONE[key.state] : ''}`}>
                        {key.enabled ? STATE_LABEL[key.state] : '已禁用'}
                      </span>
                      {key.cooldownUntil && key.state !== 'active' && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          恢复于 {new Date(key.cooldownUntil).toLocaleString()}
                        </div>
                      )}
                    </td>
                    <td className="mono">{key.qps}</td>
                    <td className="mono">
                      {key.usedToday}/{key.dailyQuota ?? '∞'}
                    </td>
                    <td className="mono">
                      {key.usedMonth}/{key.monthlyQuota ?? '∞'}
                    </td>
                    <td className="mono">
                      {key.usedTotal}/{key.totalQuota ?? '∞'}
                    </td>
                    <td>
                      <div className="row">
                        <button
                          className="btn sm"
                          onClick={() => setEditing(editing === key.id ? null : key.id)}
                        >
                          {editing === key.id ? '收起' : '编辑'}
                        </button>
                        <button
                          className="btn sm"
                          disabled={busy === `test-${key.id}`}
                          onClick={() =>
                            void run(`test-${key.id}`, async () => {
                              const result = await api.testKey(provider.id, key.id);
                              setNotice(
                                `${key.label}: ${result.message}（${result.tookMs}ms）`,
                              );
                            })
                          }
                        >
                          测试
                        </button>
                        <button
                          className="btn sm"
                          onClick={() =>
                            void run(`toggle-${key.id}`, () =>
                              api.patchKey(provider.id, key.id, { enabled: !key.enabled }),
                            )
                          }
                        >
                          {key.enabled ? '禁用' : '启用'}
                        </button>
                        <button
                          className="btn sm"
                          onClick={() =>
                            void run(
                              `reset-${key.id}`,
                              () => api.resetKey(provider.id, key.id),
                              `已重新启用 ${key.label}`,
                            )
                          }
                        >
                          解除冷却
                        </button>
                        <button
                          className="btn sm"
                          title="把日/月/总用量清零并解除隔离"
                          onClick={() => {
                            if (!confirm(`确认重置「${key.label}」的日/月/总用量计数？`)) return;
                            void run(
                              `usage-${key.id}`,
                              () => api.resetKeyUsage(provider.id, key.id),
                              `已重置 ${key.label} 的用量计数`,
                            );
                          }}
                        >
                          重置用量
                        </button>
                        <button
                          className="btn sm danger"
                          onClick={() => {
                            if (!confirm(`确认删除密钥「${key.label}」？`)) return;
                            void run(`delete-${key.id}`, () =>
                              api.deleteKey(provider.id, key.id),
                            );
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editing === key.id && (
                    <tr key={`${key.id}-edit`}>
                      <td colSpan={7} style={{ background: 'rgba(0,0,0,0.04)' }}>
                        <EditKeyForm
                          providerId={provider.id}
                          view={key}
                          onCancel={() => setEditing(null)}
                          onSaved={async (message) => {
                            setEditing(null);
                            setNotice(message);
                            await onRefresh();
                          }}
                          onError={setNotice}
                        />
                      </td>
                    </tr>
                  )}
                  </>
                ))}
              </tbody>
            </table>
          )}

          <AddKeyForm provider={provider} onRefresh={onRefresh} onNotice={setNotice} />
        </section>
      ))}
    </>
  );
}

function EditKeyForm({
  providerId,
  view,
  onCancel,
  onSaved,
  onError,
}: {
  providerId: string;
  view: KeyView;
  onCancel: () => void;
  onSaved: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [label, setLabel] = useState(view.label);
  const [value, setValue] = useState('');
  const [qps, setQps] = useState(view.qps);
  const [daily, setDaily] = useState(view.dailyQuota ? String(view.dailyQuota) : '');
  const [monthly, setMonthly] = useState(view.monthlyQuota ? String(view.monthlyQuota) : '');
  const [total, setTotal] = useState(view.totalQuota ? String(view.totalQuota) : '');
  const [enabled, setEnabled] = useState(view.enabled);
  const [saving, setSaving] = useState(false);

  const toNumber = (raw: string): number | null => (raw.trim() ? Number(raw) : null);

  async function save() {
    if (!value.trim() && label === view.label && qps === view.qps && enabled === view.enabled &&
        toNumber(daily) === view.dailyQuota && toNumber(monthly) === view.monthlyQuota &&
        toNumber(total) === view.totalQuota) {
      onError('没有需要保存的改动');
      return;
    }
    setSaving(true);
    try {
      await api.patchKey(providerId, view.id, {
        label: label.trim() || undefined,
        enabled,
        qps,
        dailyQuota: toNumber(daily),
        monthlyQuota: toNumber(monthly),
        totalQuota: toNumber(total),
        value: value.trim() || undefined, // 留空表示不修改密钥内容
      });
      await onSaved(
        value.trim() ? `已更新密钥「${label.trim() || view.label}」（含密钥内容）` : `已更新密钥「${label.trim() || view.label}」`,
      );
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="row">
        <input
          placeholder="标签"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={{ flex: '1 1 140px' }}
        />
        <input
          type="password"
          placeholder="新密钥内容（留空表示不修改）"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ flex: '2 1 260px' }}
        />
        <input
          type="number"
          min={0.1}
          step={0.1}
          title="每秒请求数上限"
          value={qps}
          onChange={(e) => setQps(Number(e.target.value))}
          style={{ width: 90 }}
        />
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <input
          type="number"
          min={1}
          placeholder="日配额"
          value={daily}
          onChange={(e) => setDaily(e.target.value)}
          style={{ width: 100 }}
        />
        <input
          type="number"
          min={1}
          placeholder="月配额"
          value={monthly}
          onChange={(e) => setMonthly(e.target.value)}
          style={{ width: 100 }}
        />
        <input
          type="number"
          min={1}
          placeholder="总配额"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
          style={{ width: 100 }}
        />
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="muted">启用</span>
        </label>
        <button className="btn primary sm" disabled={saving} onClick={() => void save()}>
          {saving ? '保存中…' : '保存'}
        </button>
        <button className="btn sm ghost" onClick={onCancel}>
          取消
        </button>
      </div>
      <p className="muted" style={{ marginTop: 8, marginBottom: 0, fontSize: 12.5 }}>
        当前摘要 <span className="mono">{view.hint}</span>；修改密钥内容后，该密钥的冷却/隔离状态会自动解除。
      </p>
    </div>
  );
}

function AddKeyForm({
  provider,
  onRefresh,
  onNotice,
}: {
  provider: ProviderView;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [qps, setQps] = useState(1);
  const [quota, setQuota] = useState('');
  const [monthly, setMonthly] = useState('');
  const [total, setTotal] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!value.trim()) {
      onNotice('请填写密钥内容');
      return;
    }
    setSaving(true);
    try {
      await api.addKey({
        providerId: provider.id,
        label: label.trim() || undefined,
        value: value.trim(),
        qps,
        dailyQuota: quota ? Number(quota) : null,
        monthlyQuota: monthly ? Number(monthly) : null,
        totalQuota: total ? Number(total) : null,
      });
      setLabel('');
      setValue('');
      setQuota('');
      setMonthly('');
      setTotal('');
      onNotice(`已添加密钥到 ${provider.displayName}`);
      await onRefresh();
    } catch (err) {
      onNotice((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="row" style={{ marginTop: 14 }}>
      <input
        placeholder={`标签，如 ${provider.id}-新key`}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        style={{ flex: '1 1 160px' }}
      />
      <input
        placeholder="密钥内容（写入后不再明文展示）"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ flex: '2 1 260px' }}
      />
      <input
        type="number"
        min={0.1}
        step={0.1}
        title="每秒请求数上限"
        value={qps}
        onChange={(e) => setQps(Number(e.target.value))}
        style={{ width: 90 }}
      />
      <input
        type="number"
        min={1}
        placeholder="日配额"
        title="每日调用上限，UTC 0 点重置，留空为不限"
        value={quota}
        onChange={(e) => setQuota(e.target.value)}
        style={{ width: 100 }}
      />
      <input
        type="number"
        min={1}
        placeholder="月配额"
        title="每月调用上限，每月 1 号 UTC 0 点重置，留空为不限"
        value={monthly}
        onChange={(e) => setMonthly(e.target.value)}
        style={{ width: 100 }}
      />
      <input
        type="number"
        min={1}
        placeholder="总配额"
        title="累计调用上限，不随时间恢复，需手动调整，留空为不限"
        value={total}
        onChange={(e) => setTotal(e.target.value)}
        style={{ width: 100 }}
      />
      <button className="btn primary" disabled={saving} onClick={() => void submit()}>
        {saving ? '添加中…' : '添加密钥'}
      </button>
    </div>
  );
}
