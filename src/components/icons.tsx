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

/** 감정 태그: 확신 — 방패 + 체크 */
export function IconShield({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M12 3l7 2.5v5c0 4.6-3 8.4-7 10.5-4-2.1-7-5.9-7-10.5v-5z" />
      <path d="M9 11.8l2.1 2.2 3.9-4" />
    </Icon>
  );
}

/** 감정 태그: 추격 — 속도선 달린 화살표 */
export function IconChase({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M8 12h12M15 7l5 5-5 5" />
      <path d="M3 8h4M4 16h4" />
    </Icon>
  );
}

/** 감정 태그: 공포 — 느낌표 삼각형 */
export function IconFear({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M12 4L21 19.5H3z" />
      <path d="M12 10v4.2M12 17h.01" />
    </Icon>
  );
}

/** 감정 태그: 원칙 — 저울 */
export function IconScale({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M12 4v16M8 20h8" />
      <path d="M5 7h14" />
      <path d="M5 7l-2.4 5a2.7 2.7 0 0 0 4.8 0z" />
      <path d="M19 7l-2.4 5a2.7 2.7 0 0 0 4.8 0z" />
    </Icon>
  );
}

/** 감정 태그: 뇌동 — 회오리 물결 */
export function IconSwirl({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M3 7.5c2.5-2.4 5-2.4 7.5 0s5 2.4 7.5 0" />
      <path d="M3 12.5c2.5-2.4 5-2.4 7.5 0s5 2.4 7.5 0" />
      <path d="M6 17.5c2.2-2.1 4.4-2.1 6.6 0s4.4 2.1 6.6 0" />
    </Icon>
  );
}

/** 감정 태그명 → 아이콘 (칩·배지 공용) */
export function EmotionIcon({ emotion, size = 16 }: { emotion: string; size?: number }) {
  if (emotion === '확신') return <IconShield size={size} />;
  if (emotion === '추격') return <IconChase size={size} />;
  if (emotion === '공포') return <IconFear size={size} />;
  if (emotion === '원칙') return <IconScale size={size} />;
  if (emotion === '뇌동') return <IconSwirl size={size} />;
  return null;
}

export function IconTrash({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13" />
    </Icon>
  );
}

export function IconUser({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c1.2-3.4 3.8-5 7-5s5.8 1.6 7 5" />
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
