// 앱 플러그인 화면 계약. 앱 화면은 지연 import(코드 분할 청크)로 뷰어 번들 안에 든다.
// 앱 목록은 확장 층이 준다(ext/ui.ts·server.ts·build.ts 에 한 항목씩). 서버 쪽 계약은 server/apps/registry.ts.
import type React from 'react';

import type { AppIconName } from './app-icons.tsx';

/** 뷰어가 앱 화면에 주는 것. apiBase 는 `/api/apps/<id>`, token 은 /apps/<id> 응답의 meta 값이다. */
export type AppHostProps = { apiBase: string; token: string; agent: boolean; navigate: (vaultPath: string) => void };

/**
 * 등록부 항목. icon 은 상단바 "앱" 메뉴·뷰어 모음 패널에 쓰는 아이콘 이름이다(이름 → SVG 는 app-icons.tsx, 모르는 이름은 기본 아이콘).
 * docLink 는 선택이다: 리더가 연 볼트 문서가 이 앱이 다루는 것이면 앱 화면 해시(`#` 없이), 아니면 null —
 * 문서 정보 패널이 "<제목>에서 열기" 링크로 쓴다. 뷰어 묶음에 바로 들므로 가벼운 순수 함수여야 한다.
 */
export type ViewerAppUi = {
  id: string;
  title: string;
  icon: AppIconName;
  load: () => Promise<{ App: React.ComponentType<AppHostProps> }>;
  docLink?: (vaultPath: string) => string | null;
};

/** 앱 화면 목록. 확장 층(ext/ui.ts 의 apps)이 주고, 화면 등록부(src/ext/registry.ts)가 검사해 낸다. */
export { APP_UIS } from '../ext/registry.ts';

/** 앱 API 기준점. 서버 server/apps/registry.ts 의 appBasePath 와 같다. */
export const appApiBase = (id: string): string => `/api/apps/${id}`;

/** 앱 루트 클래스. 앱 화면 루트 요소에 달고, appEmbed 가 앱 CSS 를 이 아래로 가둔다. */
export const appRootClass = (id: string): string => `app-${id}`;

/** id 로 찾는다. 없으면 null(화면은 "앱 없음"). */
export function findAppUi(apps: ViewerAppUi[], id: string): ViewerAppUi | null {
  return apps.find((a) => a.id === id) ?? null;
}

/** 문서 하나를 열 수 있는 앱 링크들(등록부 순서). href 는 전체 이동 주소 — 토큰 meta 가 /apps/<id> 응답에 따라온다. */
export function appDocLinks(apps: ViewerAppUi[], vaultPath: string, agent: boolean): { id: string; title: string; href: string }[] {
  const out: { id: string; title: string; href: string }[] = [];
  for (const a of apps) {
    const hash = a.docLink?.(vaultPath) ?? null;
    // 에이전트 모드면 질의(?agent=claude)를 해시 앞에 둔다.
    if (hash !== null) out.push({ id: a.id, title: a.title, href: `/apps/${a.id}${agent ? '?agent=claude' : ''}#${hash}` });
  }
  return out;
}
