import { useEffect, useState } from 'react';
import { api, type ApiKeyRecord } from '../api';

export default function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [masterConfigured, setMasterConfigured] = useState(false);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const result = await api.listApiKeys();
      setKeys(result.keys);
      setMasterConfigured(result.masterTokenConfigured);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    if (!name.trim()) {
      setError('请填写名称');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api.createApiKey(name.trim());
      setCreated(result.key);
      setName('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      await api.revokeApiKey(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('确认删除该 API Key？删除后使用该 Key 的调用方将立即失效。')) return;
    setBusy(true);
    try {
      await api.deleteApiKey(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="notice">
        调用方接入统一搜索接口必须携带 API Key：<span className="mono">x-api-key: sh_xxx</span>。
        当前 {masterConfigured ? '已配置环境变量主 Key（SEARCHHUB_API_TOKEN），同样可用' : '未配置环境变量主 Key'}。
      </div>

      {error && <div className="error-box">{error}</div>}
      {created && (
        <div className="notice">
          <div>
            创建成功，请立即保存（只显示这一次）：
            <div className="mono" style={{ marginTop: 6, wordBreak: 'break-all' }}>
              {created}
            </div>
          </div>
          <button className="btn sm" style={{ marginTop: 10 }} onClick={() => setCreated(null)}>
            我已保存
          </button>
        </div>
      )}

      <section className="card">
        <h3>API Key</h3>
        <p className="sub">只保存哈希值，明文仅在创建时返回一次；吊销后立即失效</p>

        {keys.length === 0 ? (
          <div className="empty">尚未创建 API Key</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>Key</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>最近使用</th>
                <th style={{ width: 180 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id}>
                  <td>{key.name}</td>
                  <td className="mono">
                    {key.prefix}…{key.tail}
                  </td>
                  <td>
                    <span className={`badge ${key.revoked ? 'danger' : 'ok'}`}>
                      {key.revoked ? '已吊销' : '有效'}
                    </span>
                  </td>
                  <td className="muted">{new Date(key.createdAt).toLocaleString()}</td>
                  <td className="muted">
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : '从未使用'}
                  </td>
                  <td>
                    <div className="row">
                      {!key.revoked && (
                        <button className="btn sm" disabled={busy} onClick={() => void revoke(key.id)}>
                          吊销
                        </button>
                      )}
                      <button
                        className="btn sm danger"
                        disabled={busy}
                        onClick={() => void remove(key.id)}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="row" style={{ marginTop: 14 }}>
          <input
            placeholder="名称，如 生产环境后端"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: '1 1 220px' }}
          />
          <button className="btn primary" disabled={busy} onClick={() => void create()}>
            {busy ? '创建中…' : '创建 API Key'}
          </button>
        </div>
      </section>

      <section className="card">
        <h3>接入示例</h3>
        <p className="sub">统一搜索接口（需认证）</p>
        <pre className="code-block">
{`curl -X POST http://localhost:8787/api/search \\
  -H 'content-type: application/json' \\
  -H 'x-api-key: sh_xxxxxxxxxx' \\
  -d '{"q":"openai","pageSize":10}'`}
        </pre>
        <p className="sub" style={{ marginTop: 14 }}>
          健康检查（公开，不含敏感信息）
        </p>
        <pre className="code-block">{`curl http://localhost:8787/api/health`}</pre>
      </section>
    </>
  );
}
