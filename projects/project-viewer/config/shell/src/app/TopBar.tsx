// 상단 메뉴. pages 순서대로 놓고 끝에 용어·원본을 항상 붙인다.
// 링크는 전부 <a href="#/…">라서 새 탭 열기·주소 복사가 그대로 된다.

import { useEffect, useState } from 'react';

import type { Bundle } from '../../model/types.ts';
import { formatRoute } from './router.ts';
import type { Route } from './router.ts';
import { THEME_LABEL } from './theme.ts';
import type { ThemeChoice } from './theme.ts';

function isCurrent(route: Route, target: Route): boolean {
  if (route.kind !== target.kind) return false;
  if (route.kind === 'page' && target.kind === 'page') return route.pageId === target.pageId;
  return true;
}

export function TopBar({
  bundle,
  route,
  go,
  theme,
  onToggleTheme,
}: {
  bundle: Bundle;
  route: Route;
  go: (r: Route) => void;
  theme: ThemeChoice;
  onToggleTheme: () => void;
}): React.ReactElement {
  const [q, setQ] = useState(route.kind === 'search' ? route.q : '');

  // 주소로 직접 들어온 검색어를 입력칸에 되비춘다.
  useEffect(() => {
    if (route.kind === 'search') setQ(route.q);
  }, [route]);

  const pages = bundle.viewer.pages;
  const first = pages[0];

  return (
    <header className="topbar">
      <a className="topbar__title" href={formatRoute({ kind: 'home' })}>
        {bundle.viewer.meta.title}
      </a>

      <nav className="topbar__nav" aria-label="화면">
        {pages.map((page) => {
          const target: Route = { kind: 'page', pageId: page.id };
          const current =
            isCurrent(route, target) || (route.kind === 'home' && first !== undefined && first.id === page.id);
          return (
            <a
              className="topbar__link"
              key={page.id}
              href={formatRoute(target)}
              aria-current={current ? 'page' : undefined}
            >
              {page.title}
            </a>
          );
        })}
        <span className="topbar__sep" aria-hidden="true" />
        <a
          className="topbar__link"
          href={formatRoute({ kind: 'glossary' })}
          aria-current={route.kind === 'glossary' ? 'page' : undefined}
        >
          용어
        </a>
        <a
          className="topbar__link"
          href={formatRoute({ kind: 'docs' })}
          aria-current={route.kind === 'docs' ? 'page' : undefined}
        >
          원본
        </a>
      </nav>

      <div className="topbar__tools">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const value = q.trim();
            go(value === '' ? { kind: 'home' } : { kind: 'search', q: value });
          }}
        >
          <input
            className="input topbar__search"
            type="search"
            placeholder="페이지·용어·원본 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="검색"
          />
        </form>
        <button type="button" className="btn" onClick={onToggleTheme} title="테마 전환">
          {THEME_LABEL[theme]}
        </button>
      </div>
    </header>
  );
}
