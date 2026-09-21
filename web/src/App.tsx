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
  /** 移动端侧滑菜单开关 */
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

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

  const current = TABS.find((item) => item.id === tab) ?? TABS[0]!;

  if (!authed) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }

  const selectTab = (id: TabId) => {
    setTab(id);
    setMenuOpen(false);
  };

  return (
    <div className="app">
      <Toaster />

      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <Logo size={38} />
          <div className="brand-text">
            <h1>SearchHub</h1>
            <p>统一搜索网关</p>
          </div>
          <button
            className="btn sm icon-btn ghost sidebar-close"
            aria-label="收起菜单"
            onClick={() => setMenuOpen(false)}
          >
            <Icon name="close" />
          </button>
        </div>

        <nav className="sidebar-nav">
          {TABS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${tab === item.id ? 'active' : ''}`}
              onClick={() => selectTab(item.id)}
            >
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          {state && (
            <span
              className={`badge ${state.encryptionEnabled ? 'ok' : 'warn'}`}
              title={state.encryptionEnabled ? '供应商密钥已加密存储' : '供应商密钥明文存储，建议设置 SEARCHHUB_SECRET'}
            >
              <Icon name={state.encryptionEnabled ? 'shield' : 'info'} />
              {state.encryptionEnabled ? '密钥已加密' : '密钥明文'}
            </span>
          )}
          <div className="sidebar-tools">
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
        </div>
      </aside>

      <div className={`overlay ${menuOpen ? 'show' : ''}`} onClick={() => setMenuOpen(false)} />

      <main className="main">
        <header className="topbar">
          <button
            className="btn sm icon-btn menu-btn"
            aria-label="打开菜单"
            onClick={() => setMenuOpen(true)}
          >
            <Icon name="menu" />
          </button>
          <h2 className="page-title">{current.label}</h2>
          <div className="topbar-tools">
            {state && (
              <span className="muted mono">
                {state.providers.filter((p) => p.settings.enabled).length}/{state.providers.length} 供应商启用
              </span>
            )}
          </div>
        </header>

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
            <a
              className="footer-version"
              href="https://github.com/woodcoal/SearchHub"
              target="_blank"
              rel="noreferrer"
              title="https://github.com/woodcoal/SearchHub"
            >
              SearchHub v{__APP_VERSION__} · © 2026 木炭 · MIT License
            </a>
          </div>
          <div className="footer-links">
            <button className="link-btn" onClick={() => selectTab('about')}>
              <Icon name="info" size={14} /> 关于
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}
