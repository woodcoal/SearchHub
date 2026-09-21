import { useState } from 'react';
import { api, setAdminToken } from '../api';
import Logo from './Logo';

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setError('');
    try {
      const session = await api.login(password);
      setAdminToken(session.token);
      setPassword('');
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <section className="card login-card">
        <div className="brand" style={{ marginBottom: 18 }}>
          <Logo size={44} />
          <div className="brand-text">
            <h1 style={{ fontSize: 18 }}>SearchHub 管理后台</h1>
            <p>请输入管理密码</p>
          </div>
        </div>

        {error && <div className="error-box">{error}</div>}

        <input
          type="password"
          value={password}
          placeholder="管理密码 SEARCHHUB_ADMIN_PASSWORD"
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          style={{ width: '100%' }}
        />
        <button
          className="btn primary"
          style={{ width: '100%', marginTop: 12 }}
          disabled={loading}
          onClick={() => void submit()}
        >
          {loading ? '登录中…' : '登录'}
        </button>

        <p className="muted" style={{ marginTop: 16, marginBottom: 0, fontSize: 12.5 }}>
          密码来自环境变量 <span className="mono">SEARCHHUB_ADMIN_PASSWORD</span>，
          也可在「系统设置」里修改；若都未设置，服务启动时会生成随机密码并打印在启动日志中。
        </p>
      </section>
    </div>
  );
}
