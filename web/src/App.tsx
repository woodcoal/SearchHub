import { useCallback, useEffect, useState } from 'react';
import { api, getAdminToken, setAdminToken, type StateSnapshot } from './api';
import ApiDocs from './components/ApiDocs';
import ApiKeysPanel from './components/ApiKeysPanel';
import Guide from './components/Guide';
import KeysPanel from './components/KeysPanel';
import Login from './components/Login';
import Overview from './components/Overview';
import Playground from './components/Playground';
import ProvidersPanel from './components/ProvidersPanel';
import SettingsPanel from './components/SettingsPanel';

type TabId =
  | 'overview'
  | 'keys'
  | 'providers'
  | 'access'
  | 'playground'
  | 'settings'
  | 'api-docs'
  | 'guide';
type Theme = 'dark' | 'light';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: '概览' },
  { id: 'keys', label: '密钥管理' },
  { id: 'providers', label: '供应商配置' },
  { id: 'access', label: 'API 授权' },
  { id: 'playground', label: '搜索调试' },
  { id: 'settings', label: '系统设置' },
  { id: 'api-docs', label: 'API 接口' },
  { id: 'guide', label: '使用说明' },
];

function initialTheme(): Theme {
  const saved = localStorage.getItem('searchhub.theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export default function App() {
  const [tab, setTab] = useState<TabId>('overview');
  const [state, setState] = useState<StateSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [authed, setAuthed] = useState(Boolean(getAdminToken()));
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('searchhub.theme', theme);
  }, [theme]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setState(await api.state());
      setError('');
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      if (message.includes('登录') || message.includes('unauthorized') || message.includes('401')) {
        setAuthed(false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed) void refresh();
  }, [authed, refresh]);

  useEffect(() => {
    if (!authed) return;
    const timer = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(timer);
  }, [authed, refresh]);

  if (!authed) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="logo">SH</div>
          <div>
            <h1>SearchHub</h1>
            <p>统一搜索网关 · 多供应商聚合 · 密钥轮换与自动容灾</p>
          </div>
        </div>
        <div className="header-tools">
          {state && (
            <span className={`badge ${state.encryptionEnabled ? 'ok' : 'warn'}`}>
              {state.encryptionEnabled ? '供应商密钥已加密' : '供应商密钥明文存储'}
            </span>
          )}
          <button className="btn sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? '切换亮色' : '切换深色'}
          </button>
          <button className="btn sm" disabled={loading} onClick={() => void refresh()}>
            {loading ? '刷新中…' : '刷新'}
          </button>
          <button
            className="btn sm ghost"
            onClick={() => {
              setAdminToken('');
              setAuthed(false);
              setState(null);
            }}
          >
            退出
          </button>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={`tab ${tab === item.id ? 'active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {error && <div className="error-box">{error}</div>}

      {!state ? (
        <div className="spinner">加载中…</div>
      ) : tab === 'overview' ? (
        <Overview state={state} />
      ) : tab === 'keys' ? (
        <KeysPanel state={state} onRefresh={refresh} />
      ) : tab === 'providers' ? (
        <ProvidersPanel state={state} onRefresh={refresh} />
      ) : tab === 'access' ? (
        <ApiKeysPanel />
      ) : tab === 'playground' ? (
        <Playground state={state} />
      ) : tab === 'settings' ? (
        <SettingsPanel />
      ) : tab === 'api-docs' ? (
        <ApiDocs />
      ) : (
        <Guide />
      )}
    </div>
  );
}
