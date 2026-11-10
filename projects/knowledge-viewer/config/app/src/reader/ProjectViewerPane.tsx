// viewer.yml 통합 보기의 그리는 칸. 셸 화면(ProjectViewer)을 따로 불러와(코드 분할) 볼트 뷰어 가운데 열의 스크롤 칸 안에 그린다.
// 셸 묶음(셸 화면·react-markdown·셸 CSS)은 viewer.yml 을 처음 열 때만 받는다 — 첫 화면(index 청크) 크기를 지킨다.
import { lazy, Suspense, useMemo, useSyncExternalStore } from 'react';

import type { Bundle } from '../../shared/project-viewer.ts';
import type { Source } from '../../shared/source.ts';
import { LazyBoundary } from '../app/LazyBoundary.tsx';
import { useThemePrefs } from '../app/theme-apply.ts';
import { vaultEmbedHost } from './project-viewer-host.ts';

const ProjectViewer = lazy(() =>
  import('../../../../../project-viewer/config/shell/src/embed/ProjectViewer.tsx').then((m) => ({ default: m.ProjectViewer })),
);

const DARK_QUERY = '(prefers-color-scheme: dark)';

// OS 밝기 구독. 볼트 뷰어 밝기가 auto 일 때 쓴다.
const subscribeOs = (fn: () => void): (() => void) => {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia(DARK_QUERY);
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
};
const osDark = (): boolean => typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;

/** 볼트 뷰어의 지금 밝기(light·dark). auto 면 OS 를 따른다 — tokens.css 와 같은 판정이다. */
export function useEffectiveScheme(): 'light' | 'dark' {
  const { scheme } = useThemePrefs();
  const dark = useSyncExternalStore(subscribeOs, osDark, () => false);
  return scheme === 'auto' ? (dark ? 'dark' : 'light') : scheme;
}

type Props = {
  /** viewer.yml 경로. 바뀌면 오류 경계를 걷는다. */
  spec: string;
  bundle: Bundle;
  agent: boolean;
  src: Source;
  onNavigate: (path: string, anchor?: string) => void;
};

/** 셸 화면 한 벌. 스크롤 칸(.viewer-spec-inline) 안에 둔다 — 셸의 상단 띠·하단 스탬프가 이 칸에 붙는다. */
export function ProjectViewerPane({ spec, bundle, agent, src, onNavigate }: Props) {
  const theme = useEffectiveScheme();
  // host 는 값이 바뀔 때만 새로 만든다(셸이 구독을 다시 걸지 않게).
  const host = useMemo(() => vaultEmbedHost({ agent, src, theme, onNavigate }), [agent, src, theme, onNavigate]);
  return (
    <div className="viewer-spec-inline">
      <LazyBoundary resetKey={spec} fallback={(message) => <p className="notice viewer-spec-text">셸 화면을 불러오지 못했다 — 새로고침해 달라: {message}</p>}>
        <Suspense fallback={<p className="notice viewer-spec-text">셸 화면을 불러오는 중…</p>}>
          <ProjectViewer bundle={bundle} host={host} />
        </Suspense>
      </LazyBoundary>
    </div>
  );
}
