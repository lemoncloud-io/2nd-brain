// blocks/Mermaid.tsx 가 부르는 `mermaid` 의 통합 보기 판(default 의 initialize·render 만 쓴다).
// mermaid 설정은 모듈 하나에 전역으로 붙는다. 바깥 앱(볼트 뷰어)도 같은 한 벌을 쓰므로, 셸 설정이 바깥 앱 그림에 남지 않게
// 그릴 때만 셸 설정을 걸고 끝나면 앞 설정으로 되돌린다. 밝기는 바깥 앱의 것(host.theme)을 따르고, 보안 수준은 늘 strict 다.
import mermaid from 'mermaid';

import { embedHost } from './host.ts';

type Config = Parameters<typeof mermaid.initialize>[0];

let wanted: Config = {};
// 그리기는 한 줄로 세운다 — 설정을 걸고 되돌리는 사이에 다른 그리기가 끼지 않게.
let chain: Promise<unknown> = Promise.resolve();

// 셸이 부르는 initialize 는 값만 받아 둔다(전역 설정은 그릴 때 건다).
function initialize(config: Config): void {
  wanted = config;
}

// 셸 설정(밝기·strict 덮어쓰기)으로 그리고, 앞 설정으로 되돌린다.
function render(id: string, code: string): ReturnType<typeof mermaid.render> {
  const run = async () => {
    const before = mermaid.mermaidAPI.getSiteConfig();
    mermaid.initialize({ ...wanted, theme: embedHost().theme === 'dark' ? 'dark' : 'neutral', securityLevel: 'strict' });
    try {
      return await mermaid.render(id, code);
    } finally {
      mermaid.initialize(before);
    }
  };
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
}

export default { initialize, render };
