// callout 제목 줄 아이콘. src/app/icons.tsx 와 같은 꼴(인라인 SVG, 선 1.75, currentColor)이다.
// 이름은 shared/callouts.ts 의 CalloutIconName — 모르는 이름은 note 아이콘.
import type { ReactNode } from 'react';

import type { CalloutIconName } from '../../shared/callouts.ts';
import { Svg } from '../app/icons.tsx';

const PATHS: Record<CalloutIconName, ReactNode> = {
  // 연필
  note: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <line x1="13.5" y1="6.5" x2="17.5" y2="10.5" />
    </>
  ),
  // 목록 판
  abstract: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <line x1="9" y1="9" x2="15" y2="9" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </>
  ),
  // 원 안의 i
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12" y2="8.01" />
    </>
  ),
  // 불꽃
  tip: <path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z" />,
  // 원 안의 체크
  success: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="8 12.5 11 15.5 16 9.5" />
    </>
  ),
  // 원 안의 물음표
  question: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7" />
      <line x1="12" y1="17" x2="12" y2="17.01" />
    </>
  ),
  // 세모 경고
  warning: (
    <>
      <path d="M12 4 2.5 20h19z" />
      <line x1="12" y1="10" x2="12" y2="14" />
      <line x1="12" y1="17" x2="12" y2="17.01" />
    </>
  ),
  // 팔각 금지
  danger: (
    <>
      <path d="M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7z" />
      <line x1="9" y1="9" x2="15" y2="15" />
      <line x1="15" y1="9" x2="9" y2="15" />
    </>
  ),
};

const isIconName = (v: unknown): v is CalloutIconName => typeof v === 'string' && Object.hasOwn(PATHS, v);

export function CalloutIcon({ name, size = 16 }: { name: unknown; size?: number }) {
  return <Svg size={size}>{PATHS[isIconName(name) ? name : 'note']}</Svg>;
}
