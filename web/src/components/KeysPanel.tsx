import { useRef, useState } from 'react';
import { api, type KeyView, type ProviderView, type StateSnapshot } from '../api';
import Icon, { type IconName } from './Icon';
import { toastErr, toastOk } from './Toast';

const STATE_TONE: Record<string, string> = { active: 'ok', cooling: 'warn', quarantined: 'danger' };
const STATE_LABEL: Record<string, string> = {
  active: '可用',
  cooling: '冷却中',
  quarantined: '已隔离',
};

interface TestResult {
  ok: boolean;
  text: string;
  tookMs: number;
  results?: number;
}

/** 折叠式操作菜单：默认只显示图标，避免操作栏过长 */
function ActionMenu({ items }: { items: Array<{ key: string; icon: IconName; label: string; danger?: boolean; onPick: () => void }> }) {
  const ref = useRef<HTMLDetailsElement>(null);

  return (
    <details className="menu" ref={ref}>
      <summary className="btn sm icon-btn" title="更多操作" aria-label="更多操作">
        <Icon name="more" />
      </summary>
      <div className="menu-panel">
        {items.map((item) => (
          <button
            key={item.key}
            className={item.danger ? 'menu-item danger' : 'menu-item'}
            onClick={() => {
              if (ref.current) ref.current.open = false;
              item.onPick();
            }}
          >
            <Icon name={item.icon} size={15} />
            {item.label}
          </button>
        ))}
      </div>
    </details>
  );
}

export default function KeysPanel({
  state,
  onRefresh,
}: {
  state: StateSnapshot;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  /** 每个密钥最近一次的测试结果，直接显示在按钮旁边 */
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  async function run(action: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(action);
    try {
      await fn();
      if (success) toastOk(success);
      await onRefresh();
    } catch (err) {
      toastErr((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function testKey(providerId: string, key: KeyView) {
    setBusy(`test-${key.id}`);
    try {
      const result = await api.testKey(providerId, key.id);
      setTestResults((prev) => ({
        ...prev,
        [key.id]: {
          ok: result.ok,
          text: result.message,
          tookMs: result.tookMs,
          results: result.results,
        },
      }));
      if (result.ok) toastOk(`${key.label}：${result.message}（${result.tookMs}ms）`);
      else toastErr(`${key.label}：${result.message}`);
      await onRefresh();
    } catch (err) {
      toastErr((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      {state.providers.map((provider) => (
        <section className="card" key={provider.id}>
          <div className="spread">
            <div>
              <h3>
                <Icon name="key" size={15} /> {provider.displayName}
              </h3>
              <p className="sub">
                共 {provider.keys.length} 个密钥 · 失效自动切换下一个，全部失效则切换供应商
              </p>
            </div>
            <a className="badge" href={provider.docsUrl} target="_blank" rel="noreferrer">
              <Icon name="link" size={13} /> 官方文档
            </a>
          </div>

          <p className="sub global-default">
            全局默认：QPS {provider.settings.defaultQps} · 日{' '}
            {provider.settings.defaultDailyQuota ?? '∞'} · 月{' '}
            {provider.settings.defaultMonthlyQuota ?? '∞'} · 总{' '}
            {provider.settings.defaultTotalQuota ?? '∞'}
            <span className="muted">（密钥留空的字段继承这里）</span>
          </p>

          {provider.keys.length === 0 ? (
            <div className="empty">暂无密钥</div>
          ) : (
            <table className="table-stack keys-table">
              <thead>
                <tr>
                  <th>标签 / 摘要</th>
                  <th>状态</th>
                  <th>QPS</th>
                  <th>日配额</th>
                  <th>月配额</th>
                  <th>总配额</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {provider.keys.map((key) => (
                  <KeyRow
                    key={key.id}
                    providerId={provider.id}
                    view={key}
                    busy={busy}
                    editing={editing === key.id}
                    onToggleEdit={() => setEditing(editing === key.id ? null : key.id)}
                    run={run}
                    testResult={testResults[key.id]}
                    onTest={() => void testKey(provider.id, key)}
                    onError={toastErr}
                    onRefresh={onRefresh}
                    onSaved={async (message) => {
                      setEditing(null);
                      toastOk(message);
                      await onRefresh();
                    }}
                  />
                ))}
              </tbody>
            </table>
          )}

          <AddKeyForm provider={provider} onRefresh={onRefresh} />
        </section>
      ))}
    </>
  );
}

function KeyRow({
  providerId,
  view,
  busy,
  editing,
  onToggleEdit,
  run,
  testResult,
  onTest,
  onError,
  onSaved,
}: {
  providerId: string;
  view: KeyView;
  busy: string;
  editing: boolean;
  onToggleEdit: () => void;
  run: (action: string, fn: () => Promise<unknown>, success?: string) => Promise<void>;
  testResult?: TestResult;
  onTest: () => void;
  onError: (message: string) => void;
  onRefresh: () => Promise<void>;
  onSaved: (message: string) => Promise<void>;
}) {
  const inherit = (own: number | null) =>
    own === null ? <span className="badge inherit-tag">继承</span> : null;

  return (
    <>
      <tr>
        <td data-label="密钥">
          <div className="key-label">{view.label}</div>
          <div className="mono muted">{view.hint}</div>
          {view.lastError && <div className="muted key-error">{view.lastError}</div>}
        </td>
        <td data-label="状态">
          <span className={`badge ${view.enabled ? STATE_TONE[view.state] : ''}`}>
            {view.enabled ? STATE_LABEL[view.state] : '已禁用'}
          </span>
          {view.cooldownUntil && view.state !== 'active' && (
            <div className="muted key-error">
              恢复于 {new Date(view.cooldownUntil).toLocaleString()}
            </div>
          )}
          {view.reason && <div className="muted key-error">{view.reason}</div>}
        </td>
        <td data-label="QPS" className="mono">
          {view.qps} {inherit(view.own.qps)}
        </td>
        <td data-label="日配额" className="mono">
          {view.usedToday}/{view.dailyQuota ?? '∞'} {inherit(view.own.dailyQuota)}
        </td>
        <td data-label="月配额" className="mono">
          {view.usedMonth}/{view.monthlyQuota ?? '∞'} {inherit(view.own.monthlyQuota)}
        </td>
        <td data-label="总配额" className="mono">
          {view.usedTotal}/{view.totalQuota ?? '∞'} {inherit(view.own.totalQuota)}
        </td>
        <td data-label="操作" className="col-actions">
          <div className="row actions">
            {testResult && (
              <span
                className={`test-result ${testResult.ok ? 'ok' : 'err'}`}
                title={`${testResult.text}（${testResult.tookMs}ms）`}
              >
                <Icon name={testResult.ok ? 'check' : 'close'} size={13} />
                {testResult.ok
                  ? `通过 · ${testResult.results ?? 0} 条 · ${(testResult.tookMs / 1000).toFixed(1)}s`
                  : testResult.text}
              </span>
            )}
            <button
              className="btn sm icon-btn"
              title="测试连通性"
              aria-label="测试"
              disabled={busy === `test-${view.id}`}
              onClick={onTest}
            >
              <Icon name="play" />
            </button>
            <button
              className={editing ? 'btn sm icon-btn primary' : 'btn sm icon-btn'}
              title={editing ? '收起编辑' : '编辑密钥'}
              aria-label="编辑"
              onClick={onToggleEdit}
            >
              <Icon name="edit" />
            </button>
            <ActionMenu
              items={[
                {
                  key: 'toggle',
                  icon: 'power',
                  label: view.enabled ? '禁用该密钥' : '启用该密钥',
                  onPick: () =>
                    void run(`toggle-${view.id}`, () =>
                      api.patchKey(providerId, view.id, { enabled: !view.enabled }),
                    ),
                },
                {
                  key: 'reset',
                  icon: 'rotate',
                  label: '解除冷却',
                  onPick: () =>
                    void run(
                      `reset-${view.id}`,
                      () => api.resetKey(providerId, view.id),
                      `已重新启用 ${view.label}`,
                    ),
                },
                {
                  key: 'usage',
                  icon: 'refresh',
                  label: '重置用量',
                  onPick: () => {
                    if (!confirm(`确认重置「${view.label}」的日/月/总用量计数？`)) return;
                    void run(
                      `usage-${view.id}`,
                      () => api.resetKeyUsage(providerId, view.id),
                      `已重置 ${view.label} 的用量计数`,
                    );
                  },
                },
                {
                  key: 'delete',
                  icon: 'trash',
                  label: '删除密钥',
                  danger: true,
                  onPick: () => {
                    if (!confirm(`确认删除密钥「${view.label}」？`)) return;
                    void run(`delete-${view.id}`, () => api.deleteKey(providerId, view.id));
                  },
                },
              ]}
            />
          </div>
        </td>
      </tr>
      {editing && (
        <tr className="edit-row">
          <td colSpan={7}>
            <EditKeyForm
              providerId={providerId}
              view={view}
              onCancel={onToggleEdit}
              onSaved={onSaved}
              onError={onError}
            />
          </td>
        </tr>
      )}
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
  const [qps, setQps] = useState(view.own.qps === null ? '' : String(view.own.qps));
  const [daily, setDaily] = useState(view.own.dailyQuota === null ? '' : String(view.own.dailyQuota));
  const [monthly, setMonthly] = useState(
    view.own.monthlyQuota === null ? '' : String(view.own.monthlyQuota),
  );
  const [total, setTotal] = useState(view.own.totalQuota === null ? '' : String(view.own.totalQuota));
  const [enabled, setEnabled] = useState(view.enabled);
  const [saving, setSaving] = useState(false);

  const toNumber = (raw: string): number | null => (raw.trim() ? Number(raw) : null);

  async function save() {
    setSaving(true);
    try {
      await api.patchKey(providerId, view.id, {
        label: label.trim() || undefined,
        enabled,
        qps: toNumber(qps),
        dailyQuota: toNumber(daily),
        monthlyQuota: toNumber(monthly),
        totalQuota: toNumber(total),
        value: value.trim() || undefined,
      });
      await onSaved(
        value.trim()
          ? `已更新密钥「${label.trim() || view.label}」（含密钥内容）`
          : `已更新密钥「${label.trim() || view.label}」`,
      );
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="edit-form">
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
          style={{ flex: '2 1 240px' }}
        />
        <input
          type="number"
          min={0.1}
          step={0.1}
          placeholder="QPS（留空继承全局）"
          value={qps}
          onChange={(e) => setQps(e.target.value)}
          style={{ width: 150 }}
        />
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <input
          type="number"
          min={1}
          placeholder="日配额（留空继承）"
          value={daily}
          onChange={(e) => setDaily(e.target.value)}
          style={{ width: 150 }}
        />
        <input
          type="number"
          min={1}
          placeholder="月配额（留空继承）"
          value={monthly}
          onChange={(e) => setMonthly(e.target.value)}
          style={{ width: 150 }}
        />
        <input
          type="number"
          min={1}
          placeholder="总配额（留空继承）"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
          style={{ width: 150 }}
        />
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="muted">启用</span>
        </label>
        <button className="btn primary sm" disabled={saving} onClick={() => void save()}>
          <Icon name="check" /> {saving ? '保存中…' : '保存'}
        </button>
        <button className="btn sm ghost" onClick={onCancel}>
          <Icon name="close" /> 取消
        </button>
      </div>
      <p className="muted key-error" style={{ marginTop: 8 }}>
        当前摘要 <span className="mono">{view.hint}</span>；留空的配额/ QPS 将继承供应商全局设置；
        修改密钥内容会清除该密钥的冷却与隔离状态。
      </p>
    </div>
  );
}

function AddKeyForm({
  provider,
  onRefresh,
}: {
  provider: ProviderView;
  onRefresh: () => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [qps, setQps] = useState('');
  const [quota, setQuota] = useState('');
  const [monthly, setMonthly] = useState('');
  const [total, setTotal] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!value.trim()) {
      toastErr('请填写密钥内容');
      return;
    }
    setSaving(true);
    try {
      await api.addKey({
        providerId: provider.id,
        label: label.trim() || undefined,
        value: value.trim(),
        qps: qps.trim() ? Number(qps) : null,
        dailyQuota: quota.trim() ? Number(quota) : null,
        monthlyQuota: monthly.trim() ? Number(monthly) : null,
        totalQuota: total.trim() ? Number(total) : null,
      });
      setLabel('');
      setValue('');
      setQps('');
      setQuota('');
      setMonthly('');
      setTotal('');
      toastOk(`已添加密钥到 ${provider.displayName}`);
      await onRefresh();
    } catch (err) {
      toastErr((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="add-key">
      <div className="row">
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
          style={{ flex: '2 1 240px' }}
        />
        <input
          type="number"
          min={0.1}
          step={0.1}
          placeholder="QPS"
          title="留空继承供应商全局设置"
          value={qps}
          onChange={(e) => setQps(e.target.value)}
          style={{ width: 100 }}
        />
      </div>
      <div className="row add-key-row">
        <input
          type="number"
          min={1}
          placeholder="日配额"
          title="留空继承供应商全局设置，UTC 0 点重置"
          value={quota}
          onChange={(e) => setQuota(e.target.value)}
          style={{ width: 120 }}
        />
        <input
          type="number"
          min={1}
          placeholder="月配额"
          title="留空继承供应商全局设置，每月 1 号 UTC 0 点重置"
          value={monthly}
          onChange={(e) => setMonthly(e.target.value)}
          style={{ width: 120 }}
        />
        <input
          type="number"
          min={1}
          placeholder="总配额"
          title="留空继承供应商全局设置，不随时间恢复"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
          style={{ width: 120 }}
        />
        <button className="btn primary" disabled={saving} onClick={() => void submit()}>
          <Icon name="plus" /> {saving ? '添加中…' : '添加密钥'}
        </button>
      </div>
    </div>
  );
}
