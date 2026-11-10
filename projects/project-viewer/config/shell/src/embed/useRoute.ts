// app/useRoute.ts 의 통합 보기 판. 같은 이름(useRoute·scrollToId)을 내보낸다.
// 라우트는 host 가 읽고 쓴다(볼트 뷰어는 주소의 해시에 둔다 — 뒤로·앞으로가 그대로 된다).
// 스크롤은 창이 아니라 셸 루트를 품은 스크롤 칸에서 한다(볼트 뷰어의 가운데 열).

import { useCallback, useEffect, useRef, useState } from 'react';

import { formatRoute as formatHash, parseHash, sameScreen } from '../app/router.ts';
import type { Route } from '../app/router.ts';
import { embedHost, embedRoot } from './host.ts';
import { vaultDocOf } from './router.ts';

export function useRoute(): { route: Route; go: (next: Route, replace?: boolean) => void } {
  const host = embedHost();
  const [route, setRoute] = useState<Route>(() => parseHash(host.readHash()));

  // host 가 알리면(앱 안 이동·뒤로·앞으로) 다시 읽는다.
  useEffect(() => host.subscribe(() => setRoute(parseHash(host.readHash()))), [host]);

  // 원본 문서 하나를 가리키는 라우트(손으로 친 주소 등)는 바깥 앱의 리더로 넘긴다 — 기록은 바꿔 쓴다.
  useEffect(() => {
    const target = vaultDocOf(route);
    if (target !== null) host.openDoc(target.path, target.anchor, true);
  }, [host, route]);

  // 다른 화면으로 옮기면 스크롤 칸을 맨 위로 — 볼트 뷰어에서 문서를 옮길 때와 같다. 항목·용어를 고른 이동은 App 이 그 자리로 보낸다.
  const shown = useRef(route);
  useEffect(() => {
    const before = shown.current;
    shown.current = route;
    if (before === route || sameScreen(before, route)) return;
    if ((route.kind === 'page' && route.itemId !== undefined) || (route.kind === 'glossary' && route.termId !== undefined)) return;
    const root = embedRoot();
    if (root !== null) scrollParent(root).scrollTo({ top: 0, behavior: 'auto' });
  }, [route]);

  // 라우트를 쓴다. 같은 주소면 화면만 맞춘다.
  const go = useCallback(
    (next: Route, replace = false) => {
      const hash = formatHash(next);
      if (host.readHash() !== hash) host.writeHash(hash, replace);
      setRoute(next);
    },
    [host],
  );

  // 바깥 앱 리더로 넘어가는 중에는 원본 목록을 그려 둔다(빈 화면 대신).
  return { route: vaultDocOf(route) === null ? route : { kind: 'docs' }, go };
}

/** el 을 세로로 스크롤하는 가장 가까운 조상. 없으면 문서 스크롤 요소. */
function scrollParent(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p !== null; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** 본문이 구르는 곳(원래 판과 같은 이름). 셸 본문 칸(.main > .page)이 구르면 그것, 아니면 루트를 품은 스크롤 칸.
 *  문서 전체가 구르면 null — 부르는 쪽이 window 를 쓴다. */
export function scrollRoot(): HTMLElement | null {
  const root = embedRoot();
  if (root === null) return null;
  const page = root.querySelector<HTMLElement>('.main > .page');
  if (page !== null) {
    const oy = getComputedStyle(page).overflowY;
    if (oy === 'auto' || oy === 'scroll') return page;
  }
  const box = scrollParent(root);
  return box === document.scrollingElement ? null : box;
}

/** 셸 루트 안에서 id 로 요소를 찾는다. 바깥 앱에 같은 id 가 있어도 셸 것을 고른다. */
function findInRoot(id: string): HTMLElement | null {
  const root = embedRoot();
  if (root === null) return document.getElementById(id);
  for (const el of root.querySelectorAll<HTMLElement>('[id]')) if (el.id === id) return el;
  return null;
}

// 절·항목으로 이동한다. 고정된 상단 띠(.appbar)에 가리지 않게 그 높이만큼 비운다(원래 판과 같은 규칙).
export function scrollToId(id: string): boolean {
  const el = findInRoot(id);
  if (!el) return false;
  const box = scrollParent(el);
  const bar = embedRoot()?.querySelector('.appbar');
  const offset = (bar ? bar.getBoundingClientRect().height : 0) + 16;
  const boxTop = box === document.scrollingElement ? 0 : box.getBoundingClientRect().top;
  const top = el.getBoundingClientRect().top - boxTop + box.scrollTop - offset;
  box.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  return true;
}
