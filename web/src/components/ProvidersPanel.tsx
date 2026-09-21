import { useState } from 'react';
import { api, type ProviderSettings, type StateSnapshot } from '../api';

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
        优先级数字越小越优先。主供应商全部密钥不可用时，自动切换到下一家；连续失败达到阈值会熔断该供应商，冷却结束后半开探测。
      </div>
      <div className="grid-2">
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
        <h3>{settings.id}</h3>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => update('enabled', e.target.checked)}
          />
          <span className="muted">启用</span>
        </label>
      </div>

      <div className="grid-2" style={{ gap: 12, marginTop: 12 }}>
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
          {saving ? '保存中…' : '保存配置'}
        </button>
        <button className="btn ghost" onClick={() => setForm(settings)}>
          还原
        </button>
        {message && <span className="muted">{message}</span>}
      </div>
    </section>
  );
}
