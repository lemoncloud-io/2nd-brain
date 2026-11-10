// viewer.yml 보기의 원문·렌더 토글. 탭(세션) 동안만 기억한다 — 새 탭·다시 연 창은 늘 렌더 보기로 시작한다.
// sessionStorage 도 던질 수 있다(사생활 모드·차단·SSR) — 못 읽으면 기본(렌더), 못 써도 화면은 바뀐다.

const VIEWER_SPEC_VIEW_KEY = 'knowledge-viewer.viewer-spec-view';

export type ViewerSpecMode = 'rendered' | 'raw';

export function readViewerSpecMode(): ViewerSpecMode {
  try {
    return sessionStorage.getItem(VIEWER_SPEC_VIEW_KEY) === 'raw' ? 'raw' : 'rendered';
  } catch {
    return 'rendered';
  }
}

export function writeViewerSpecMode(mode: ViewerSpecMode): void {
  try {
    sessionStorage.setItem(VIEWER_SPEC_VIEW_KEY, mode);
  } catch {
    // 저장 못 해도 화면은 바뀐다
  }
}
