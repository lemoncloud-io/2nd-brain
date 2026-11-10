// viewer.yml 통합 보기의 host — 셸 화면(ProjectViewer)이 볼트 뷰어와 닿는 자리. 순수 함수와 작은 창 어댑터다.
// 셸 라우트는 볼트 뷰어 주소의 해시에 그대로 둔다: `/v/<viewer.yml>?src=…#/p/<페이지>/<항목>`.
// 볼트 뷰어의 다른 앵커(절 슬러그·줄 앵커 `L12`)는 `/` 로 시작하지 않으므로 겹치지 않는다(slug 는 `/` 를 담지 않는다).
// 해시를 바꾸면 브라우저 방문 기록이 쌓이므로 뒤로·앞으로가 셸 화면 이동에도 그대로 된다.
import type { EmbedHost, EmbedTheme } from '../../../../../project-viewer/config/shell/src/embed/host.ts';
import type { Source } from '../../shared/source.ts';
import { hrefFor } from '../app/route.ts';

/** 셸 라우트 해시인가(`#/…`). */
export function isShellHash(hash: string): boolean {
  return hash.startsWith('#/');
}

/** 주소의 해시 중 셸 라우트만. 아니면 ''(셸 첫 화면). 퍼센트 부호화는 풀지 않는다 — 셸 라우터가 조각마다 푼다. */
export function shellHashOf(hash: string): string {
  return isShellHash(hash) ? hash : '';
}

/** viewer.yml 통합 보기의 한 화면 주소. shellHash 는 셸 라우터가 만든 `#/…` 그대로다. */
export function shellRouteHref(spec: string, shellHash: string, agent: boolean, src: Source): string {
  return hrefFor(spec, isShellHash(shellHash) ? shellHash.slice(1) : undefined, agent, src);
}

/** host 를 만드는 데 필요한 것. win 은 시험이 바꾼다(없으면 전역 창, SSR 이면 hash 를 쓴다). */
export type VaultHostDeps = {
  agent: boolean;
  src: Source;
  theme: EmbedTheme;
  /** 볼트 문서 열기(앱 안 이동). App 의 navigate 다. */
  onNavigate: (path: string, anchor?: string) => void;
  /** 창이 없을 때(SSR) 읽을 셸 해시. */
  hash?: string;
};

/** 볼트 뷰어의 host. 라우트는 주소의 해시, 원본 문서는 볼트 뷰어 리더(같은 소스)로 연다. */
export function vaultEmbedHost(deps: VaultHostDeps): EmbedHost {
  const { agent, src, theme, onNavigate } = deps;
  const hasWindow = typeof window !== 'undefined';
  // replaceState 는 popstate 를 내지 않는다. App(볼트 뷰어 라우트)과 셸이 같은 주소를 보게 한 번 알린다.
  const notify = () => window.dispatchEvent(new PopStateEvent('popstate'));
  return {
    readHash: () => (hasWindow ? shellHashOf(window.location.hash) : shellHashOf(deps.hash ?? '')),
    writeHash: (hash, replace) => {
      if (!hasWindow) return;
      if (replace) {
        window.history.replaceState(null, '', hash);
        notify();
      } else {
        // 해시 대입은 기록을 하나 쌓고 hashchange·popstate 를 낸다(App 과 셸이 함께 듣는다).
        window.location.hash = hash;
      }
    },
    subscribe: (cb) => {
      if (!hasWindow) return () => {};
      window.addEventListener('hashchange', cb);
      window.addEventListener('popstate', cb);
      return () => {
        window.removeEventListener('hashchange', cb);
        window.removeEventListener('popstate', cb);
      };
    },
    docHref: (path, anchor) => hrefFor(path, anchor, agent, src),
    openDoc: (path, anchor, replace) => {
      if (replace === true && hasWindow) {
        window.history.replaceState(null, '', hrefFor(path, anchor, agent, src));
        notify();
        return;
      }
      onNavigate(path, anchor);
    },
    theme,
  };
}
