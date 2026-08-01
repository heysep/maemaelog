/** 24px SVG 라인 아이콘 (stroke 1.8) — 이모지 대체 */
import type { ReactNode } from 'react';

function Icon({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconPen({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1z" />
      <path d="M13.5 7.5l3 3" />
    </Icon>
  );
}

export function IconHome({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M4 10.5L12 4l8 6.5V20h-5.5v-5h-5v5H4z" />
    </Icon>
  );
}

export function IconList({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </Icon>
  );
}

export function IconChart({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M7 5v3m0 8v3M7 8h-2v8h2zM7 8h2v8H7z" />
      <path d="M17 3v3m0 8v3M17 6h-2v8h2zM17 6h2v8h-2z" />
    </Icon>
  );
}

export function IconCamera({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
      <circle cx="12" cy="13" r="3.2" />
    </Icon>
  );
}

export function IconTrash({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13" />
    </Icon>
  );
}

export function IconInfo({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M12 11.5V16" />
    </Icon>
  );
}
