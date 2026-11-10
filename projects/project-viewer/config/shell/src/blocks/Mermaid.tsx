// mermaid 블록. 실제로 쓸 때만 번들에 들어가도록 동적 import를 쓰고,
// 렌더에 실패해도 페이지가 죽지 않게 코드를 그대로 보여 준다.

import { useEffect, useRef, useState } from 'react';

import type { MermaidBlock } from '../../model/types.ts';

let seq = 0;

function isDark(): boolean {
  const chosen = document.documentElement.getAttribute('data-theme');
  if (chosen === 'dark') return true;
  if (chosen === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// 그림도 화면 테마를 따라야 한다. 테마가 바뀌면 다시 그린다.
function useDarkFlag(): boolean {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const sync = () => setDark(isDark());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', sync);
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener('change', sync);
      mo.disconnect();
    };
  }, []);
  return dark;
}

export function Mermaid({ block }: { block: MermaidBlock }): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const dark = useDarkFlag();

  useEffect(() => {
    let alive = true;
    const id = `mermaid-${(seq += 1)}`;
    (async () => {
      try {
        const mod = await import('mermaid');
        const mermaid = mod.default;
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral' });
        const { svg } = await mermaid.render(id, block.code);
        if (!alive) return;
        const host = hostRef.current;
        if (host) host.innerHTML = svg;
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [block.code, dark]);

  if (failed) {
    return (
      <div className="mermaid">
        <div className="muted">그림을 그리지 못해 원본 코드를 그대로 보여 준다.</div>
        <pre className="mermaid__fallback">{block.code}</pre>
      </div>
    );
  }

  // mermaid가 만든 SVG를 붙일 자리. 문자열 주입은 이 한 곳뿐이고 입력은 yml의 mermaid 코드다.
  return <div className="mermaid scroll-x" ref={hostRef} role="img" aria-label={block.title ?? '보조 그림'} />;
}
