import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type PluginOption } from 'vite';

// project-viewer 셸 화면을 컴포넌트로 불러 그린다(viewer.yml 통합 보기). 플러그인이 셸 어댑터를 바꿔 끼우고
// 셸 라이브러리를 이 앱의 한 벌로 맞추며, 셸 CSS 는 .pv-root 아래로 가두고 이 앱 CSS 는 그 안을 피하게 한다.
// 런타임 import 는 node 내장뿐이라 셸 node_modules 가 없어도 이 설정은 읽힌다.
import { projectViewerEmbed } from '../../../project-viewer/config/shell/loader/embed-plugin.ts';
// 앱 플러그인 화면(/apps/<id>): 앱 CSS 는 .app-<id> 아래로, 이 앱 CSS 는 그 안을 피하게, React 는 한 벌로.
import { appEmbed } from './app-embed-plugin.ts';
// 확장 층(유닛 밖 ext/): 화면 확장 가상 모듈과 확장이 내는 앱 화면·Vite 플러그인.
import { extVirtual, hostCss, loadBuildExtension } from './ext-build.ts';

const root = path.dirname(fileURLToPath(import.meta.url));
const api = 'http://127.0.0.1:8778';

// 서버(8778)가 dist/를 낸다. 단일 파일 플러그인은 쓰지 않고 assetsDir 기본값(assets)을 지킨다.
// 설정을 읽을 때 확장 build.ts 를 한 번 읽는다(없으면 빈 값, 깨졌으면 빌드를 멈춘다).
export default defineConfig(async () => {
  const ext = await loadBuildExtension();
  const appEmbeds = ext.appEmbeds.map((a) => ({ id: a.id, dir: a.dir, rootClass: a.rootClass ?? `app-${a.id}` }));
  return {
    root,
    base: '/',
    // 이 앱 스타일(src/styles/**)은 셸 루트 안에 닿지 않는다 — 반대 방향 누수 방지.
    // 순서: 확장 가상 모듈 → 확장 플러그인 → 코어 플러그인(셸·앱 화면) → React.
    plugins: [extVirtual(), ...(ext.plugins as PluginOption[]), projectViewerEmbed({ hostCss }), ...appEmbeds.map((a) => appEmbed({ ...a, hostCss })), react()],
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
  };
});
