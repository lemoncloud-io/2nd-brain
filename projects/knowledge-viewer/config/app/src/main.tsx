import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

import { ErrorScreen } from './app/ErrorScreen.tsx';
import { createViewerError, installGlobalErrorHandlers } from './app/errors.ts';
import { ViewerErrorBoundary } from './app/ViewerErrorBoundary.tsx';
import { applyStoredTheme } from './app/theme-apply.ts';
import './styles/tokens.css';
// 화면 테마는 tokens.css 다음이어야 덮는다.
import './styles/themes/index.css';
import './styles/layout.css';
import './styles/tree.css';
import './styles/reader.css';
import './styles/callout.css';
import './styles/frame.css';
import './styles/search.css';
import './styles/panels.css';
import './styles/viewers-panel.css';
import './styles/graph.css';
import './styles/theme-select.css';
import './styles/shortcuts.css';
import './styles/file-view.css';
import './styles/highlight.css';
import './styles/viewer-spec.css';
import './styles/switching.css';
import './styles/errors.css';
import './styles/apps.css';
// 모바일 규칙은 맨 뒤 — 같은 무게의 규칙을 좁은 폭에서 덮는다.
import './styles/mobile.css';

// App 모듈 로딩 실패도 오류 경계가 받는다.
const App = lazy(() => import('./app/App.tsx').then((module) => ({ default: module.App })));
const stopGlobalErrors = installGlobalErrorHandlers(window);
if (import.meta.hot) import.meta.hot.dispose(stopGlobalErrors);
const root = createRoot(document.getElementById('root')!);
try {
  // 첫 그리기 전에 저장된 테마를 적용한다.
  applyStoredTheme();
  root.render(
    <StrictMode>
      <ViewerErrorBoundary root>
        <Suspense fallback={<main className="viewer-fatal">뷰어를 불러오는 중…</main>}>
          <App />
        </Suspense>
      </ViewerErrorBoundary>
    </StrictMode>,
  );
} catch (error) {
  root.render(<main className="viewer-fatal"><ErrorScreen error={createViewerError(error, 'startup')} /></main>);
}
