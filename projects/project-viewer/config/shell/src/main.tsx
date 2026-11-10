import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/blocks.css';
// reader.css는 리더(src/reader/)가 스스로 불러온다 — 이 파일은 그 소유가 아니다.
import { App } from './app/App.tsx';
import { installScrollReveal } from './app/scroll-reveal.ts';

installScrollReveal();

const host = document.getElementById('root');
if (host) {
  createRoot(host).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
