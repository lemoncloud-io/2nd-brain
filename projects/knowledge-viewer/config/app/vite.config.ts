import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const api = 'http://127.0.0.1:8778';

// 서버(8778)가 dist/를 낸다. 단일 파일 플러그인은 쓰지 않고 assetsDir 기본값(assets)을 지킨다.
export default defineConfig({
  root,
  base: '/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  // 개발 서버도 127.0.0.1 에만 묶는다. changeOrigin 은 쓰지 않는다 — Host 를 그대로 넘겨야
  // 본 서버의 호스트 분할(/api 는 127.0.0.1 만, /raw 는 루프백 이름만)이 같게 돈다.
  // 8779 는 본 서버의 git 소스 출처 포트(8778 + 1)라 쓰지 않는다.
  server: {
    host: '127.0.0.1',
    port: 8777,
    strictPort: true,
    proxy: { '/api': api, '/raw': api },
  },
});
