import { useId } from 'react';

/**
 * SearchHub 标识：放大镜（搜索）+ 多节点汇聚（多家供应商汇入统一出口）。
 */
export default function Logo({ size = 40 }: { size?: number }) {
  const gradientId = useId();
  const ink = '#08152f';

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
          <stop offset="0%" stopColor="#2dd4bf" />
          <stop offset="55%" stopColor="#5b8cff" />
          <stop offset="100%" stopColor="#8b7cff" />
        </linearGradient>
      </defs>

      <rect x="2" y="2" width="60" height="60" rx="17" fill={`url(#${gradientId})`} />

      <g stroke={ink} strokeWidth="1.8" opacity="0.45">
        <path d="M28 19v9.5" />
        <path d="M19.5 37.5 26 30.5" />
        <path d="M21 19.5 14 25" />
        <path d="M37 21l8-5.5" />
      </g>

      <circle cx="28" cy="30" r="11.5" fill={`url(#${gradientId})`} />
      <circle cx="28" cy="30" r="11.5" fill="none" stroke={ink} strokeWidth="3.2" />
      <path
        d="M36.6 38.6 46.5 48.5"
        stroke={ink}
        strokeWidth="4.6"
        strokeLinecap="round"
        fill="none"
      />

      <g fill={ink}>
        <circle cx="21" cy="17.5" r="3.1" />
        <circle cx="15.5" cy="27" r="2.6" />
        <circle cx="47" cy="14" r="2.6" />
      </g>
    </svg>
  );
}
