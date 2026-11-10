// 해시 라우터의 부수효과 쪽. 순수 부분은 router.ts에 있다.
// hashchange를 직접 듣는 이유는 샌드박스 iframe에서 네이티브 앵커 이동이 동작하지 않기 때문이다(F4).

import { useCallback, useEffect, useState } from 'react';

import { parseHash, formatRoute } from './router.ts';
import type { Route } from './router.ts';

export function useRoute(): { route: Route; go: (next: Route, replace?: boolean) => void } {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    // 히스토리 API로 주소가 바뀌는 경우(뒤로/앞으로)도 같이 받는다
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);

  const go = useCallback((next: Route, replace = false) => {
    const hash = formatRoute(next);
    if (window.location.hash === hash) {
      setRoute(next);
      return;
    }
    if (replace) {
      // 출처가 불투명한 문서(샌드박스 iframe, srcdoc)에서는 replaceState가 던질 수 있다. 주소를 못 바꿔도 화면은 바뀌어야 한다.
      try {
        window.history.replaceState(null, '', hash);
      } catch {
        // 주소 표시만 포기한다
      }
      setRoute(next);
    } else {
      window.location.hash = hash;
    }
  }, []);

  return { route, go };
}

/** 본문이 구르는 곳. 넓은 화면은 본문 칸(.main > .page)이 스크롤 칸이고(layout.css § 두 칸 스크롤),
 *  좁은 화면은 문서 전체(window)다 — 그때는 null. */
export function scrollRoot(): HTMLElement | null {
  const page = document.querySelector<HTMLElement>('.main > .page');
  if (!page) return null;
  const oy = getComputedStyle(page).overflowY;
  return oy === 'auto' || oy === 'scroll' ? page : null;
}

// 절·항목으로 이동할 때 브라우저의 앵커 동작에 기대지 않고 JS로 스크롤한다.
export function scrollToId(id: string): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  // 이동은 즉시 한다. 부드러운 스크롤은 보이지 않는 탭이나 미리보기 창에서 진행되지 않아
  // "눌렀는데 그 자리로 안 간다"가 된다(실측).
  const root = scrollRoot();
  if (root) {
    // 본문 칸이 구르면 상단 띠는 칸 밖이라 가리지 않는다. 칸 위쪽에서 조금만 띄운다
    const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 16;
    root.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    return true;
  }
  // 문서가 구르면 고정된 상단 띠에 가려지지 않게 그 높이만큼 비운다.
  const bar = document.querySelector('.appbar');
  const offset = (bar ? bar.getBoundingClientRect().height : 0) + 16;
  const top = el.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  return true;
}
