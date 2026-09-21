import { useCallback, useEffect, useState } from 'react';
import { api, getAdminToken, setAdminToken, type StateSnapshot } from './api';
import About from './components/About';
import ApiDocs from './components/ApiDocs';
import ApiKeysPanel from './components/ApiKeysPanel';
import Guide from './components/Guide';
import Icon, { type IconName } from './components/Icon';
import KeysPanel from './components/KeysPanel';
import Login from './components/Login';
import Logo from './components/Logo';
import Overview from './components/Overview';
import Playground from './components/Playground';
import ProvidersPanel from './components/ProvidersPanel';
import LogsPanel from './components/LogsPanel';
import SettingsPanel from './components/SettingsPanel';
import { Toaster } from './components/Toast';
import UsagePanel from './components/UsagePanel';

type TabId =
  | 'overview'
  | 'usage'
  | 'keys'
  | 'providers'
  | 'access'
  | 'playground'
  | 'logs'
  | 'settings'
  | 'api-docs'
  | 'guide'
  | 'about';
type Theme = 'dark' | 'light';

const TABS: Array<{ id: TabId; label: string; icon: IconName }> = [
  { id: 'overview', label: '概览', icon: 'gauge' },
  { id: 'usage', label: '用量统计', icon: 'chart' },
  { id: 'keys', label: '密钥管理', icon: 'key' },
  { id: 'providers', label: '供应商配置', icon: 'box' },
  { id: 'access', label: 'API 授权', icon: 'shield' },
  { id: 'playground', label: '搜索调试', icon: 'search' },
  { id: 'logs', label: '日志', icon: 'list' },
  { id: 'settings', label: '系统设置', icon: 'sliders' },
  { id: 'api-docs', label: 'API 接口', icon: 'code' },
  { id: 'guide', label: '使用说明', icon: 'book' },
  { id: 'about', label: '关于', icon: 'info' },
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
      <Toaster />
      <header className="header">
        <div className="brand">
          <Logo size={42} />
          <div className="brand-text">
            <h1>SearchHub</h1>
            <p>统一搜索网关 · 多供应商聚合 · 密钥轮换与自动容灾</p>
          </div>
        </div>

        <div className="header-tools">
          {state && (
            <span
              className={`badge ${state.encryptionEnabled ? 'ok' : 'warn'}`}
              title={state.encryptionEnabled ? '供应商密钥已加密存储' : '供应商密钥明文存储，建议设置 SEARCHHUB_SECRET'}
            >
              <Icon name={state.encryptionEnabled ? 'shield' : 'info'} />
              <span className="btn-label">
                {state.encryptionEnabled ? '密钥已加密' : '密钥明文'}
              </span>
            </span>
          )}
          <button
            className="btn sm icon-btn"
            title={theme === 'dark' ? '切换亮色主题' : '切换深色主题'}
            aria-label="切换主题"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            <span className="btn-label">{theme === 'dark' ? '亮色' : '深色'}</span>
          </button>
          <button
            className="btn sm icon-btn"
            title="刷新数据"
            aria-label="刷新"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <Icon name="refresh" className={loading ? 'spin' : undefined} />
            <span className="btn-label">刷新</span>
          </button>
          <button
            className="btn sm icon-btn ghost"
            title="退出登录"
            aria-label="退出"
            onClick={() => {
              setAdminToken('');
              setAuthed(false);
              setState(null);
            }}
          >
            <Icon name="logout" />
            <span className="btn-label">退出</span>
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
            <Icon name={item.icon} size={15} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {error && <div className="error-box">{error}</div>}

      {tab === 'about' ? (
        <About />
      ) : !state ? (
        <div className="spinner">加载中…</div>
      ) : tab === 'overview' ? (
        <Overview state={state} />
      ) : tab === 'usage' ? (
        <UsagePanel />
      ) : tab === 'keys' ? (
        <KeysPanel state={state} onRefresh={refresh} />
      ) : tab === 'providers' ? (
        <ProvidersPanel state={state} onRefresh={refresh} />
      ) : tab === 'access' ? (
        <ApiKeysPanel />
      ) : tab === 'playground' ? (
        <Playground state={state} />
      ) : tab === 'logs' ? (
        <LogsPanel />
      ) : tab === 'settings' ? (
        <SettingsPanel />
      ) : tab === 'api-docs' ? (
        <ApiDocs />
      ) : (
        <Guide />
      )}

      <footer className="footer">
        <div className="footer-main">
          <Logo size={18} />
          <span>SearchHub v{__APP_VERSION__} · © 2026 木炭 · MIT License</span>
          <a
            className="footer-repo"
            href="https://github.com/woodcoal/SearchHub"
            target="_blank"
            rel="noreferrer"
            title="https://github.com/woodcoal/SearchHub"
          >
            <Icon name="link" size={14} />
            github.com/woodcoal/SearchHub
          </a>
        </div>
        <div className="footer-links">
          <button className="link-btn" onClick={() => setTab('about')}>
            <Icon name="info" size={14} /> 关于
          </button>
        </div>
      </footer>
    </div>
  );
}
