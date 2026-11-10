// 가운데 열의 앱 화면(`/apps/<id>`). 등록부에서 id 를 찾아 지연 import 한 App 을 그린다.
// 해시는 앱 것이다 — 뷰어는 앵커로 읽지 않는다. import 실패는 이 자리(LazyBoundary)에만 안내를 남긴다.
import { lazy, Suspense } from 'react';
import type React from 'react';

import { LazyBoundary } from '../app/LazyBoundary.tsx';
import { appHref } from '../app/route.ts';
import { appApiBase, appRootClass, findAppUi, type AppHostProps, type ViewerAppUi } from './registry.ts';

/** id 마다 lazy 컴포넌트 하나 — 다시 그려도 청크를 다시 받지 않게 모듈에 둔다. */
const lazyCache = new Map<string, React.LazyExoticComponent<React.ComponentType<AppHostProps>>>();

/** 등록부 항목의 lazy 컴포넌트. load() 가 거부하면 Suspense 밖 경계(LazyBoundary)가 받는다. */
function lazyOf(ui: ViewerAppUi): React.LazyExoticComponent<React.ComponentType<AppHostProps>> {
  let c = lazyCache.get(ui.id);
  if (c === undefined) {
    c = lazy(() => ui.load().then((m) => ({ default: m.App })));
    lazyCache.set(ui.id, c);
  }
  return c;
}

export type AppViewProps = {
  id: string;
  apps: ViewerAppUi[];
  token: string;
  agent: boolean;
  /** 볼트 경로를 뷰어 리더(/v/<path>)로 연다. */
  navigate: (vaultPath: string) => void;
};

/** 앱 화면 한 칸. 없는 앱·토큰 없음·불러오기 실패를 각각 안내한다. */
export function AppView({ id, apps, token, agent, navigate }: AppViewProps) {
  const ui = findAppUi(apps, id);
  // 등록되지 않은 id: 등록된 앱 목록을 함께 보인다(전체 페이지 이동이라 토큰 meta 가 따라온다).
  if (ui === null) {
    return (
      <section className="app-missing">
        <h1>앱 없음</h1>
        <p className="notice">
          등록되지 않은 앱이다: <code>{id}</code>
        </p>
        {apps.length > 0 ? (
          <ul className="app-missing-list">
            {apps.map((a) => (
              <li key={a.id}>
                <a href={appHref(a.id, agent)}>{a.title}</a>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    );
  }
  // 토큰은 /apps/<id> 응답의 meta 에만 있다. 다른 주소로 연 문서면 새로 고침이 답이다.
  if (token === '') {
    return (
      <p className="notice" role="status">
        앱 토큰이 없다 — <a href={appHref(id, agent)}>이 주소로 다시 열기</a>
      </p>
    );
  }
  const App = lazyOf(ui);
  return (
    <div className="app-host" data-app-id={id}>
      <LazyBoundary resetKey={id} fallback={(message) => <p className="notice">앱 화면을 불러오지 못했다 — {ui.title}: {message}</p>}>
        <Suspense fallback={<p className="notice">앱을 불러오는 중…</p>}>
          <div className={appRootClass(id)}>
            <App apiBase={appApiBase(id)} token={token} agent={agent} navigate={navigate} />
          </div>
        </Suspense>
      </LazyBoundary>
    </div>
  );
}
