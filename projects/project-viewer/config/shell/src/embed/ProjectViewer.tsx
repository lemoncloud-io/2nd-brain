// 셸 화면을 다른 React 앱(볼트 뷰어) 안에 컴포넌트로 그린다. iframe·빌드 산출물을 거치지 않는다.
// 데이터(Bundle)와 바깥과 닿는 자리(host: 라우트·원본 문서 열기·밝기)를 받고, 셸 App 을 그대로 그린다.
// 바깥 앱은 Vite 플러그인(loader/embed-plugin.ts)을 써야 한다 — 그 플러그인이 어댑터를 바꿔 끼우고 CSS 를 가둔다.
// 셸 단독 빌드(src/main.tsx)는 이 파일을 부르지 않는다.
import { useEffect, useLayoutEffect, useRef } from 'react';
import type React from 'react';

import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/layout.css';
import '../styles/blocks.css';
import type { Bundle } from '../../model/types.ts';
import { App } from '../app/App.tsx';
import { installScrollReveal } from '../app/scroll-reveal.ts';
import { docLinkOf, setEmbed, setEmbedRoot } from './host.ts';
import type { EmbedHost, EmbedTheme } from './host.ts';
// 덧칠은 셸 CSS 다음에 둔다(reader.css 는 App 아래 리더가 부른다).
import './embed.css';

export type { EmbedHost, EmbedTheme };

/** 셸 루트 클래스. 플러그인(EMBED_ROOT_CLASS)과 같아야 한다. */
export const ROOT_CLASS = 'pv-root';

// Bundle 객체마다 번호를 매겨 App 의 key 로 쓴다 — 데이터가 바뀌면 첫 마운트 때 만든 색인(검색·항목)도 새로 만든다.
// 밝기도 key 에 넣는다 — 셸 mermaid 그림은 밝기가 바뀌어도 스스로 다시 그리지 않으므로(<html> 속성만 본다) 새로 마운트한다.
const keys = new WeakMap<Bundle, number>();
let seq = 0;
function keyOf(bundle: Bundle): number {
  let k = keys.get(bundle);
  if (k === undefined) {
    seq += 1;
    k = seq;
    keys.set(bundle, k);
  }
  return k;
}

/** 수정키 없이 왼쪽 단추로 누른 경우만 앱 안 이동으로 바꾼다. 나머지(새 탭 등)는 브라우저에 맡긴다. */
function isPlainClick(e: React.MouseEvent): boolean {
  return !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0;
}

export function ProjectViewer({ bundle, host }: { bundle: Bundle; host: EmbedHost }): React.ReactElement {
  // 셸 화면 코드(어댑터)가 그리는 동안 읽을 값을 먼저 둔다.
  setEmbed(bundle, host);
  const ref = useRef<HTMLDivElement | null>(null);

  // 루트 요소를 알린다(스크롤·id 찾기의 기준).
  useLayoutEffect(() => {
    setEmbedRoot(ref.current);
    return () => setEmbedRoot(null);
  }, []);

  // 스크롤바는 구르는 동안만 보인다(단독 판의 main.tsx 와 같은 규칙) — 떠날 때 푼다.
  useEffect(() => installScrollReveal(document), []);

  // 셸이 바꾼 문서 제목은 떠날 때 되돌린다.
  useEffect(() => {
    const before = document.title;
    return () => {
      document.title = before;
    };
  }, []);

  // 원본 문서 링크(router 어댑터가 만든 바깥 주소)는 앱 안 이동으로 바꾼다. 셸 해시 링크는 브라우저 기본 동작 그대로다.
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || !isPlainClick(e)) return;
    const a = (e.target as Element | null)?.closest?.('a[href]');
    if (!a || a.getAttribute('target') === '_blank') return;
    const target = docLinkOf(a.getAttribute('href') ?? '');
    if (target === undefined) return;
    e.preventDefault();
    host.openDoc(target.path, target.anchor);
  };

  return (
    <div ref={ref} className={`${ROOT_CLASS} pv-embed`} data-theme={host.theme} onClick={onClick}>
      <App key={`${keyOf(bundle)}:${host.theme}`} />
    </div>
  );
}
