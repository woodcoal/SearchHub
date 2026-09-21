import { useEffect, useState } from 'react';
import { api, type SystemSettings } from '../api';
import Icon from './Icon';
import Logo from './Logo';

const STACK = [
  'TypeScript / Node.js',
  'Fastify 5',
  'React 18 + Vite',
  'Zod 校验',
  'Pino 日志',
  '@modelcontextprotocol/sdk',
];

const MCP_TOOLS = [
  { name: 'searchhub_search', desc: '执行统一搜索，自动完成密钥轮换与供应商切换' },
  { name: 'searchhub_status', desc: '查看熔断状态、密钥可用数与调用统计' },
  { name: 'searchhub_providers', desc: '列出内置供应商及其能力' },
];

export default function About() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .settings()
      .then(setSettings)
      .catch((err: Error) => setError(err.message));
  }, []);

  const uptime = settings
    ? `${Math.floor(settings.uptimeSec / 3600)} 小时 ${Math.floor((settings.uptimeSec % 3600) / 60)} 分`
    : '—';

  return (
    <>
      {error && <div className="error-box">{error}</div>}

      <section className="card about-hero">
        <Logo size={72} />
        <div>
          <h2>SearchHub</h2>
          <p className="sub">
            统一搜索网关 · 把多家异构搜索 API 收敛成一套协议，集中管理密钥并自动容灾
          </p>
          <div className="row">
            <span className="badge accent">v{settings?.version ?? __APP_VERSION__}</span>
            <span className="badge">MIT License</span>
            <span className="badge">Node {settings?.node ?? '—'}</span>
            <span className="badge">{settings?.platform ?? '—'}</span>
          </div>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <h3>
            <Icon name="info" size={15} /> 软件信息
          </h3>
          <table>
            <tbody>
              <tr>
                <td className="muted" style={{ width: 110 }}>
                  名称
                </td>
                <td>SearchHub（统一搜索网关）</td>
              </tr>
              <tr>
                <td className="muted">版本</td>
                <td className="mono">{settings?.version ?? __APP_VERSION__}</td>
              </tr>
              <tr>
                <td className="muted">作者</td>
                <td>木炭</td>
              </tr>
              <tr>
                <td className="muted">邮箱</td>
                <td>
                  <a href="mailto:woodcoal@qq.com">woodcoal@qq.com</a>
                </td>
              </tr>
              <tr>
                <td className="muted">仓库</td>
                <td>
                  <a href="https://github.com/woodcoal/SearchHub" target="_blank" rel="noreferrer">
                    github.com/woodcoal/SearchHub
                  </a>
                </td>
              </tr>
              <tr>
                <td className="muted">npm</td>
                <td>
                  <a href="https://www.npmjs.com/package/searchhub" target="_blank" rel="noreferrer">
                    npmjs.com/package/searchhub
                  </a>
                </td>
              </tr>
              <tr>
                <td className="muted">许可</td>
                <td>MIT License · Copyright (c) 2026 木炭</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="card">
          <h3>
            <Icon name="gauge" size={15} /> 运行环境
          </h3>
          <table>
            <tbody>
              <tr>
                <td className="muted" style={{ width: 110 }}>
                  Node 版本
                </td>
                <td className="mono">{settings?.node ?? '—'}</td>
              </tr>
              <tr>
                <td className="muted">运行平台</td>
                <td className="mono">{settings?.platform ?? '—'}</td>
              </tr>
              <tr>
                <td className="muted">已运行</td>
                <td className="mono">{uptime}</td>
              </tr>
              <tr>
                <td className="muted">启动时间</td>
                <td className="mono">
                  {settings?.startedAt ? new Date(settings.startedAt).toLocaleString() : '—'}
                </td>
              </tr>
              <tr>
                <td className="muted">技术栈</td>
                <td>{STACK.join(' · ')}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <section className="card">
        <h3>
          <Icon name="box" size={15} /> 内置供应商
        </h3>
        <p className="sub">按优先级自动调度，失败自动切换；每家都实现了独立的错误分级</p>
        <table>
          <thead>
            <tr>
              <th>标识</th>
              <th>名称</th>
              <th>能力</th>
              <th>翻页</th>
              <th>文档</th>
            </tr>
          </thead>
          <tbody>
            {(settings?.providers ?? []).map((provider) => (
              <tr key={provider.id}>
                <td className="mono">{provider.id}</td>
                <td>{provider.displayName}</td>
                <td className="muted">{provider.capabilities.join(' / ')}</td>
                <td>
                  {provider.supportsPaging ? (
                    <span className="badge ok">支持</span>
                  ) : (
                    <span className="badge">不支持</span>
                  )}
                </td>
                <td>
                  <a href={provider.docsUrl} target="_blank" rel="noreferrer">
                    官方文档
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid-2">
        <section className="card">
          <h3>
            <Icon name="code" size={15} /> MCP 工具
          </h3>
          <p className="sub">
            执行 <span className="mono">searchhub mcp</span> 即以 stdio 传输启动，供 AI 客户端接入
          </p>
          <table>
            <tbody>
              {MCP_TOOLS.map((tool) => (
                <tr key={tool.name}>
                  <td className="mono" style={{ width: 170 }}>
                    {tool.name}
                  </td>
                  <td className="muted">{tool.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h3>
            <Icon name="database" size={15} /> 数据与日志
          </h3>
          <table>
            <tbody>
              <tr>
                <td className="muted" style={{ width: 110 }}>
                  数据目录
                </td>
                <td className="mono">{settings?.dataDir ?? '—'}</td>
              </tr>
              <tr>
                <td className="muted">数据文件</td>
                <td className="mono">{settings?.dataFile ?? '—'}</td>
              </tr>
              <tr>
                <td className="muted">日志目录</td>
                <td className="mono">{settings?.logDir ?? '—'}</td>
              </tr>
              <tr>
                <td className="muted">日志保留</td>
                <td className="mono">
                  {settings
                    ? settings.logRetentionDays > 0
                      ? `${settings.logRetentionDays} 天`
                      : '永久保留'
                    : '—'}
                </td>
              </tr>
              <tr>
                <td className="muted">设置文件</td>
                <td className="mono">{settings?.settingsFile ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
