import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App.tsx';
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
// 모바일 규칙은 맨 뒤 — 같은 무게의 규칙을 좁은 폭에서 덮는다.
import './styles/mobile.css';

// 첫 그리기 전에 저장된 테마를 <html> 에 둔다 — 기본 색이 한 번 비쳤다 바뀌는 깜빡임을 막는다.
applyStoredTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
