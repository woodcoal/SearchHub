import { useId } from 'react';

/**
 * SearchHub 标识：外圈是多家搜索供应商的节点环，连线聚焦到中心的放大镜，
 * 表达「多源汇聚、统一检索」。描边与镜片底色跟随主题（CSS 变量 --logo-ink / --logo-lens）。
 */
export default function Logo({ size = 40 }: { size?: number }) {
  const gradientId = useId();
  const gradientRef = `url(#${gradientId})`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="SearchHub"
      className="logo-svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2D9CDB" />
          <stop offset="100%" stopColor="#3FE0D0" />
        </linearGradient>
      </defs>

      {/* 节点环与连线 */}
      <g className="logo-ink-stroke" fill="none" strokeWidth="2.4">
        <circle cx="32" cy="32" r="24" />
      </g>
      <g className="logo-ink-stroke" fill="none" strokeWidth="2">
        <path d="M47.8 32h3.8" />
        <path d="M43.17 43.17l2.69 2.69" />
        <path d="M32 47.8v3.8" />
        <path d="M20.83 43.17l-2.69 2.69" />
        <path d="M16.2 32h-3.8" />
        <path d="M20.83 20.83l-2.69-2.69" />
        <path d="M32 16.2v-3.8" />
        <path d="M43.17 20.83l2.69-2.69" />
      </g>

      {/* 供应商节点 */}
      <g strokeWidth="1.8">
        <circle cx="32" cy="8" r="3.4" fill="#3FE0D0" className="logo-ink-stroke" />
        <circle cx="48.97" cy="15.03" r="3" className="logo-hollow" />
        <circle cx="56" cy="32" r="3.4" fill={gradientRef} className="logo-ink-stroke" />
        <circle cx="48.97" cy="48.97" r="3" fill="#FFFFFF" stroke="#2D9CDB" strokeWidth="2" />
        <circle cx="32" cy="56" r="3.4" fill="#3FE0D0" className="logo-ink-stroke" />
        <circle cx="15.03" cy="48.97" r="3.4" fill="#A8E063" className="logo-ink-stroke" />
        <circle cx="8" cy="32" r="3.4" fill="#A8E063" className="logo-ink-stroke" />
        <circle cx="15.03" cy="15.03" r="3.4" fill="#4FD8E8" className="logo-ink-stroke" />
      </g>

      {/* 放大镜手柄 */}
      <path
        className="logo-ink-stroke"
        d="M23 40.2 15.6 47.6"
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
      />

      {/* 镜片 */}
      <circle cx="32" cy="31" r="12.6" className="logo-lens logo-ink-stroke" strokeWidth="4.2" />
      <path
        d="M25.4 25.6a9 9 0 0 1 5-3.4"
        fill="none"
        stroke="#BFE0FF"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.85"
      />
    </svg>
  );
}
