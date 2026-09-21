import { useState } from 'react';
import { api, type ProviderSettings, type StateSnapshot } from '../api';
import Icon from './Icon';

export default function ProvidersPanel({
  state,
  onRefresh,
}: {
  state: StateSnapshot;
  onRefresh: () => Promise<void>;
}) {
  return (
    <>
      <div className="notice">
        优先级数字越小越优先。主供应商全部密钥不可用时自动切换到下一家；连续失败达到阈值会熔断该供应商。
        供应商级别的 <b>全局 QPS 与配额</b> 会被「密钥里留空」的字段继承，适合先统一兜底、再对个别密钥单独调整。
      </div>
      <div className="provider-grid grid-2">
        {state.providers.map((provider) => (
          <ProviderForm key={provider.id} settings={provider.settings} onRefresh={onRefresh} />
        ))}
      </div>
    </>
  );
}

function ProviderForm({
  settings,
  onRefresh,
}: {
  settings: ProviderSettings;
  onRefresh: () => Promise<void>;
}) {
  const [form, setForm] = useState<ProviderSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const update = <K extends keyof ProviderSettings>(key: K, value: ProviderSettings[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const numberOrNull = (raw: string): number | null => (raw.trim() ? Number(raw) : null);

  async function save() {
    setSaving(true);
    setMessage('');
    try {
      await api.updateProvider(settings.id, {
        enabled: form.enabled,
        priority: form.priority,
        timeoutMs: form.timeoutMs,
        maxKeyAttempts: form.maxKeyAttempts,
        failureThreshold: form.failureThreshold,
        cooldownMs: form.cooldownMs,
        defaultQps: form.defaultQps,
        defaultDailyQuota: form.defaultDailyQuota,
        defaultMonthlyQuota: form.defaultMonthlyQuota,
        defaultTotalQuota: form.defaultTotalQuota,
      });
      setMessage('已保存');
      await onRefresh();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card">
      <div className="spread">
        <h3>
          <Icon name="box" size={15} /> {settings.id}
        </h3>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => update('enabled', e.target.checked)}
          />
          <span className="muted">启用</span>
        </label>
      </div>

      <p className="sub" style={{ marginTop: 10, marginBottom: 6 }}>
        全局默认（密钥留空时继承）
      </p>
      <div className="grid-2 form-grid">
        <div className="field">
          <label>全局 QPS（每秒请求上限）</label>
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={form.defaultQps}
            onChange={(e) => update('defaultQps', Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>全局日配额</label>
          <input
            type="number"
            min={1}
            placeholder="不限"
            value={form.defaultDailyQuota ?? ''}
            onChange={(e) => update('defaultDailyQuota', numberOrNull(e.target.value))}
          />
        </div>
        <div className="field">
          <label>全局月配额</label>
          <input
            type="number"
            min={1}
            placeholder="不限"
            value={form.defaultMonthlyQuota ?? ''}
            onChange={(e) => update('defaultMonthlyQuota', numberOrNull(e.target.value))}
          />
        </div>
        <div className="field">
          <label>全局总配额</label>
          <input
            type="number"
            min={1}
            placeholder="不限"
            value={form.defaultTotalQuota ?? ''}
            onChange={(e) => update('defaultTotalQuota', numberOrNull(e.target.value))}
          />
        </div>
      </div>

      <p className="sub" style={{ marginTop: 16, marginBottom: 6 }}>
        调度与容灾
      </p>
      <div className="grid-2 form-grid">
        <div className="field">
          <label>优先级（越小越优先）</label>
          <input
            type="number"
            min={0}
            value={form.priority}
            onChange={(e) => update('priority', Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>单次请求超时（ms）</label>
          <input
            type="number"
            min={1000}
            step={500}
            value={form.timeoutMs}
            onChange={(e) => update('timeoutMs', Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>单供应商最多试几个密钥</label>
          <input
            type="number"
            min={1}
            max={10}
            value={form.maxKeyAttempts}
            onChange={(e) => update('maxKeyAttempts', Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>熔断阈值（连续失败次数）</label>
          <input
            type="number"
            min={1}
            value={form.failureThreshold}
            onChange={(e) => update('failureThreshold', Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label>熔断冷却时长（ms）</label>
          <input
            type="number"
            min={1000}
            step={1000}
            value={form.cooldownMs}
            onChange={(e) => update('cooldownMs', Number(e.target.value))}
          />
        </div>
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary" disabled={saving} onClick={() => void save()}>
          <Icon name="check" /> {saving ? '保存中…' : '保存配置'}
        </button>
        <button className="btn ghost" onClick={() => setForm(settings)}>
          <Icon name="rotate" /> 还原
        </button>
        {message && <span className="muted">{message}</span>}
      </div>
    </section>
  );
}
