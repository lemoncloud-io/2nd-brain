// 상단바 "앱" 메뉴. 등록된 앱(화면 등록부)을 링크로 모은다. 등록된 앱이 없으면 그리지 않는다.
// 링크는 전체 페이지 이동이다 — 서버가 /apps/<id> 응답에만 토큰 meta 를 넣는다.
// 단추는 격자 아이콘(글자 없음, aria-label·title 은 "앱"), 항목 앞에는 그 앱의 아이콘을 그린다.
import { IconGrid } from '../app/icons.tsx';
import { appHref } from '../app/route.ts';
import { AppIcon } from './app-icons.tsx';
import type { ViewerAppUi } from './registry.ts';

export type AppsMenuProps = { apps: ViewerAppUi[]; agent: boolean; current?: string };

/** 등록된 앱이 0 이면 null. 지금 연 앱은 aria-current 로 표시한다. */
export function AppsMenu({ apps, agent, current }: AppsMenuProps) {
  if (apps.length === 0) return null;
  return (
    <details className="apps-menu">
      <summary className="icon-btn apps-toggle" aria-label="앱" title="앱">
        <IconGrid />
      </summary>
      <ul className="apps-menu-list" role="menu">
        {apps.map((a) => (
          <li key={a.id} role="none">
            <a role="menuitem" href={appHref(a.id, agent)} aria-current={a.id === current ? 'page' : undefined} data-app-id={a.id}>
              <span className="apps-menu-icon" aria-hidden="true">
                <AppIcon name={a.icon} size={14} />
              </span>
              {a.title}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
