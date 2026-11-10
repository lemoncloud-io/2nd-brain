// Vite 개발 서버에서만 여는 수동 회귀 시험. 제품 빌드에는 포함되지 않는다.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RuntimeErrorGate, ViewerErrorBoundary } from '../../src/app/ViewerErrorBoundary.tsx';
import { installGlobalErrorHandlers } from '../../src/app/errors.ts';
import '../../src/styles/tokens.css';
import '../../src/styles/layout.css';
import '../../src/styles/frame.css';
import '../../src/styles/graph.css';
import '../../src/styles/errors.css';

const stop = installGlobalErrorHandlers(window);
if (import.meta.hot) import.meta.hot.dispose(stop);

function Body() {
  const [failed, setFailed] = useState(false);
  if (failed) throw new Error('시험용 문서 렌더링 오류');
  return <>
    <h1>시험 문서</h1>
    <button onClick={() => setFailed(true)}>렌더링 오류 발생</button>
    <button onClick={() => { throw new Error('시험용 스크립트 실행 오류'); }}>실행 오류 발생</button>
    <button onClick={() => { void Promise.reject(new Error('시험용 비동기 오류')); }}>비동기 오류 발생</button>
  </>;
}

function Harness() {
  const [rootFailed, setRootFailed] = useState(false);
  const [doc, setDoc] = useState(1);
  if (rootFailed) throw new Error('시험용 앱 전체 오류');
  const params = new URLSearchParams(window.location.search);
  const layout = params.get('layout');
  const center = layout === 'frame' ? 'col col-center col-center-frame' : layout === 'graph' ? 'col col-center col-center-graph' : 'col col-center';
  return <div className="app app-left-collapsed app-right-collapsed" style={params.has('compact') ? { height: 280 } : undefined}>
    <header className="topbar"><strong>탐색 메뉴 유지</strong>
      <div className="viewer-error-actions" style={{ margin: 0 }}><button onClick={() => setDoc(doc + 1)}>다음 문서</button>
      <button onClick={() => setRootFailed(true)}>앱 전체 오류 발생</button></div>
    </header>
    <main className={center}>
      <ViewerErrorBoundary resetKey={String(doc)}><RuntimeErrorGate><Body /></RuntimeErrorGate></ViewerErrorBoundary>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><ViewerErrorBoundary root><Harness /></ViewerErrorBoundary></StrictMode>);
