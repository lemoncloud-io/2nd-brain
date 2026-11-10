// 앱 아이콘. 등록부(registry.ts)는 가벼운 순수 모듈이라 아이콘 이름만 갖고, 이름 → SVG 는 여기서 고른다.
// 아이콘은 src/app/icons.tsx 의 Svg 래퍼라 상단바 다른 단추와 선 굵기·크기 규칙이 같다.
import type { ComponentType } from 'react';

import { IconBranch, IconChecklist, IconGrid, IconPr } from '../app/icons.tsx';

/** 등록부가 쓸 수 있는 아이콘 이름. 새 이름은 여기와 APP_ICONS 에 함께 더한다. */
export type AppIconName = 'grid' | 'checklist' | 'pr' | 'branch';

/** 이름 → 아이콘 컴포넌트. */
const APP_ICONS: Record<AppIconName, ComponentType<{ size?: number }>> = {
  grid: IconGrid,
  checklist: IconChecklist,
  // GitHub 이슈·PR 데스크 — 뷰어의 PR 아이콘을 같이 쓴다.
  pr: IconPr,
  // 워크트리 렌즈 — 뷰어의 브랜치(워크트리 배지) 아이콘을 같이 쓴다.
  branch: IconBranch,
};

/** 앱 아이콘 하나. 모르는 이름(없음 포함)이면 기본 아이콘(격자)으로 그려 화면이 깨지지 않게 한다. */
export function AppIcon({ name, size }: { name?: string | null; size?: number }) {
  // 자기 속성만 찾는다 — 'toString' 같은 상속 이름이 컴포넌트로 잡히지 않게.
  const Icon = name != null && Object.prototype.hasOwnProperty.call(APP_ICONS, name) ? APP_ICONS[name as AppIconName] : IconGrid;
  return <Icon size={size} />;
}
