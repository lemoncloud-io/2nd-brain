// 상단바 아이콘. 의존성 없이 인라인 SVG — 16px, 선 1.75, currentColor. 글 대신 쓰므로 단추가 aria-label 을 가진다.
import type { ReactNode } from 'react';

type IconProps = { size?: number };

export function Svg({ size = 16, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** 왼쪽 패널(트리). open 이면 안쪽을 채운다. */
export function IconPanelLeft({ open, size }: IconProps & { open: boolean }) {
  return (
    <Svg size={size}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
      {open ? <rect x="3" y="4" width="6" height="16" rx="2" fill="currentColor" stroke="none" /> : null}
    </Svg>
  );
}

/** 오른쪽 패널(보조). open 이면 안쪽을 채운다. */
export function IconPanelRight({ open, size }: IconProps & { open: boolean }) {
  return (
    <Svg size={size}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="15" y1="4" x2="15" y2="20" />
      {open ? <rect x="15" y="4" width="6" height="16" rx="2" fill="currentColor" stroke="none" /> : null}
    </Svg>
  );
}

/** 연결 지도: 점 셋과 간선. */
export function IconMap({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <circle cx="11" cy="18" r="2.5" />
      <line x1="8.2" y1="7" x2="15.6" y2="7.6" />
      <line x1="7.2" y1="8.2" x2="9.8" y2="15.8" />
      <line x1="16.6" y1="10.2" x2="12.6" y2="16" />
    </Svg>
  );
}

/** 북마크 별. on 이면 채운다. */
export function IconStar({ on, size }: IconProps & { on: boolean }) {
  return (
    <Svg size={size}>
      <polygon points="12 3 14.9 9.1 21.5 9.9 16.7 14.5 18 21 12 17.8 6 21 7.3 14.5 2.5 9.9 9.1 9.1" fill={on ? 'currentColor' : 'none'} />
    </Svg>
  );
}

export function IconSearch({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="11" cy="11" r="6.5" />
      <line x1="16" y1="16" x2="21" y2="21" />
    </Svg>
  );
}

/** 설정 톱니. */
export function IconGear({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Svg>
  );
}

/** 브랜치(워크트리 배지). */
export function IconBranch({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <path d="M6 7.5v9" />
      <path d="M18 10.5c0 3-3 4-6 4.5s-6 1.5-6 4" />
    </Svg>
  );
}

/** PR(머지 화살). */
export function IconPr({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M6 7.5v9" />
      <path d="M18 16.5V11a3 3 0 0 0-3-3h-3" />
      <path d="M14.5 5.5 12 8l2.5 2.5" />
    </Svg>
  );
}

/** 크게 보기(연결 지도 패널 → 지도 화면): 네 모서리로 벌어지는 화살표. */
export function IconExpand({ size }: IconProps) {
  return (
    <Svg size={size}>
      <polyline points="15 4 20 4 20 9" />
      <polyline points="9 20 4 20 4 15" />
      <line x1="20" y1="4" x2="14" y2="10" />
      <line x1="4" y1="20" x2="10" y2="14" />
    </Svg>
  );
}

/** 실행(뷰어 모음 패널): 오른쪽을 가리키는 삼각형. */
export function IconPlay({ size }: IconProps) {
  return (
    <Svg size={size}>
      <polygon points="7 4.5 19 12 7 19.5" fill="currentColor" />
    </Svg>
  );
}

/** 새 탭으로 열기: 상자와 바깥으로 나가는 화살표. */
export function IconExternal({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M18 13.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H11" />
      <polyline points="15 3.5 20.5 3.5 20.5 9" />
      <line x1="11" y1="13" x2="20.5" y2="3.5" />
    </Svg>
  );
}

/** 지침서(SKILL.md): 펼친 책. */
export function IconBook({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M12 6.5C10.5 5 8 4.5 3.5 4.5v14c4.5 0 7 .5 8.5 2 1.5-1.5 4-2 8.5-2v-14c-4.5 0-7 .5-8.5 2z" />
      <line x1="12" y1="6.5" x2="12" y2="20.5" />
    </Svg>
  );
}

/** 새로 고침: 끝에 화살촉이 달린 고리. */
export function IconRefresh({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <polyline points="20 4 20 9 15 9" />
    </Svg>
  );
}

/** 목차(패널 제목): 머리 점이 붙은 줄 셋, 둘째·셋째는 들여 쓴다. */
export function IconToc({ size }: IconProps) {
  return (
    <Svg size={size}>
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="12" y1="12" x2="20" y2="12" />
      <line x1="12" y1="18" x2="20" y2="18" />
      <circle cx="5" cy="6" r="1" fill="currentColor" />
      <circle cx="8" cy="12" r="1" fill="currentColor" />
      <circle cx="8" cy="18" r="1" fill="currentColor" />
    </Svg>
  );
}

/** 역링크(패널 제목): 이 문서로 돌아 들어오는 화살표. */
export function IconBacklink({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M20 5v6a4 4 0 0 1-4 4H5" />
      <polyline points="9 11 5 15 9 19" />
    </Svg>
  );
}

/** 문서 정보(패널 제목): 원 안의 i. */
export function IconInfo({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16.5" />
      <circle cx="12" cy="7.5" r="0.6" fill="currentColor" />
    </Svg>
  );
}

/** PR 상세(패널 제목): 바뀐 줄을 표시한 문서. */
export function IconDiff({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <polyline points="14 3 14 8 19 8" />
      <line x1="12" y1="11" x2="12" y2="15" />
      <line x1="10" y1="13" x2="14" y2="13" />
      <line x1="10" y1="17.5" x2="14" y2="17.5" />
    </Svg>
  );
}

/** 뷰어 모음(패널 제목): 네 칸 격자. */
export function IconGrid({ size }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
    </Svg>
  );
}
