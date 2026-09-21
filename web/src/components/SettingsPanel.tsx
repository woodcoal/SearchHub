import { useEffect, useState } from 'react';
import { api, type MigrationResult, type SystemSettings } from '../api';

export default function SettingsPanel() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [dir, setDir] = useState('');
  const [migrating, setMigrating] = useState(false);
  const [result, setResult] = useState<MigrationResult | null>(null);

  async function load() {
    try {
      const next = await api.settings();
      setSettings(next);
      setDir(next.dataDir);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function savePassword() {
    setError('');
    setNotice('');
    if (newPassword.length < 6) {
      setError('新密码至少 6 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    setSavingPassword(true);
    try {
      await api.updatePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice('密码已更新，所有已登录会话立即失效，需要重新登录');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingPassword(false);
    }
  }

  async function migrate() {
    if (!dir.trim()) {
      setError('请输入目标目录');
      return;
    }
    if (
      !confirm(
        `确认把数据目录迁移到 ${dir.trim()}？\n现有数据文件会自动复制过去，旧目录的文件会保留。`,
      )
    ) {
      return;
    }
    setMigrating(true);
    setError('');
    setNotice('');
    setResult(null);
    try {
      setResult(await api.migrateDataDir(dir.trim()));
      setNotice('迁移完成');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMigrating(false);
    }
  }

  return (
    <>
      {error && <div className="error-box">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <section className="card">
        <h3>后台密码</h3>
        <p className="sub">
          当前密码来源：
          {settings?.passwordSource === 'ui' ? (
            <span className="badge ok">界面设置</span>
          ) : (
            <span className="badge warn">环境变量 / 启动随机生成</span>
          )}
          {settings?.passwordUpdatedAt && (
            <span className="muted" style={{ marginLeft: 8 }}>
              最近修改：{new Date(settings.passwordUpdatedAt).toLocaleString()}
            </span>
          )}
        </p>

        <div className="row">
          <input
            type="password"
            placeholder="当前密码"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            style={{ flex: '1 1 180px' }}
          />
          <input
            type="password"
            placeholder="新密码（至少 6 位）"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={{ flex: '1 1 180px' }}
          />
          <input
            type="password"
            placeholder="确认新密码"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void savePassword();
            }}
            style={{ flex: '1 1 180px' }}
          />
          <button className="btn primary" disabled={savingPassword} onClick={() => void savePassword()}>
            {savingPassword ? '保存中…' : '修改密码'}
          </button>
        </div>

        <div className="notice" style={{ marginTop: 14, marginBottom: 0 }}>
          密码保存在 <span className="mono">{settings?.settingsFile ?? 'settings.json'}</span>，
          只存 scrypt 哈希。修改后所有登录会话立即失效，需要重新登录；
          一旦在界面设置过密码，环境变量 <span className="mono">SEARCHHUB_ADMIN_PASSWORD</span> 将不再生效。
        </div>
      </section>

      <section className="card">
        <h3>数据保存目录</h3>
        <p className="sub">修改后现有数据会自动迁移到新目录，旧文件保留，不会删除</p>

        <table>
          <tbody>
            <tr>
              <td style={{ width: 130 }} className="muted">默认根目录</td>
              <td className="mono">{settings?.homeDir}</td>
            </tr>
            <tr>
              <td className="muted">当前数据目录</td>
              <td className="mono">{settings?.dataDir}</td>
            </tr>
            <tr>
              <td className="muted">数据文件</td>
              <td className="mono">{settings?.dataFile}</td>
            </tr>
            <tr>
              <td className="muted">日志目录</td>
              <td className="mono">{settings?.logDir}</td>
            </tr>
            <tr>
              <td className="muted">设置文件</td>
              <td className="mono">{settings?.settingsFile}</td>
            </tr>
          </tbody>
        </table>

        <div className="row" style={{ marginTop: 14 }}>
          <input
            placeholder="新的数据目录，如 D:/searchhub-data"
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            style={{ flex: '1 1 320px' }}
          />
          <button className="btn primary" disabled={migrating} onClick={() => void migrate()}>
            {migrating ? '迁移中…' : '迁移到该目录'}
          </button>
        </div>

        {result && (
          <div className="notice" style={{ marginTop: 14, marginBottom: 0 }}>
            <div>
              已迁移到 <span className="mono">{result.dataDir}</span>
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              已处理 {result.movedFiles.length} 个文件：
            </div>
            <div className="mono" style={{ marginTop: 4, wordBreak: 'break-all' }}>
              {result.movedFiles.join('\n')}
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              原位置：<span className="mono">{result.previousDataFile}</span>（保留）
            </div>
          </div>
        )}
      </section>
    </>
  );
}
