// 바깥 React 앱(볼트 뷰어)의 Vite 설정에 넣는 플러그인. 셸 화면을 컴포넌트로 불러 그릴 때 필요한 것만 한다.
//  1. 바꿔 끼우기: 데이터·라우트·테마·원본 주소 모듈을 src/embed/ 어댑터로(embed-redirects.ts 의 표).
//  2. 한 벌 맞추기: 셸이 쓰는 라이브러리(React 등)를 바깥 앱의 node_modules 한 벌로 푼다(resolve.dedupe).
//  3. 스타일 격리: 셸 CSS 는 루트 클래스 아래로 가두고, 바깥 앱 CSS 는(고른 파일만) 그 루트 안에 닿지 않게 한다.
// 셸 단독 빌드(cli build·vite.config.ts)는 이 플러그인을 쓰지 않는다. 런타임 import 는 node 내장뿐이다 —
// 셸 node_modules 가 없어도 바깥 앱의 설정이 읽힌다. 타입도 vite 에서 가져오지 않는다(바깥 앱의 vite 와 판이 달라도
// 구조로 맞는다).
import fs from 'node:fs';
import path from 'node:path';

import { embedRedirect, isShellStyle, SHELL_DIR, shellDependencies } from './embed-redirects.ts';
import { excludeCss, scopeCss } from './scope-css.ts';

/** 셸 화면의 루트 클래스. src/embed/ProjectViewer.tsx 의 루트 요소와 같아야 한다. */
export const EMBED_ROOT_CLASS = 'pv-root';

/** Vite 플러그인 중 이 플러그인이 쓰는 부분(구조 타입). */
export interface EmbedPlugin {
  name: string;
  enforce: 'pre';
  config(config: { root?: string }): { resolve: { dedupe: string[] }; server: { fs: { allow: string[] } } };
  resolveId(source: string, importer: string | undefined): string | null;
  transform(code: string, id: string): { code: string; map: null } | null;
}

export interface EmbedPluginOptions {
  /** 바깥 앱의 CSS 중 셸 루트 안에 닿지 않게 할 파일인가(절대경로, 질의 없이). 없으면 바깥 CSS 는 그대로다. */
  hostCss?: (file: string) => boolean;
}

/** Vite 모듈 id 에서 질의·해시를 뗀 파일 경로. */
function fileOf(id: string): string {
  return id.split('?')[0]!.split('#')[0]!;
}

export function projectViewerEmbed(options: EmbedPluginOptions = {}): EmbedPlugin {
  const root = `.${EMBED_ROOT_CLASS}`;
  return {
    name: 'project-viewer-embed',
    enforce: 'pre',

    // 셸 라이브러리를 바깥 앱 한 벌로. 개발 서버가 셸 폴더(앱 루트 밖)를 읽게 허용한다.
    config(config) {
      const appRoot = path.resolve(config.root ?? process.cwd());
      return {
        resolve: { dedupe: shellDependencies((p) => fs.readFileSync(p, 'utf8')) },
        server: { fs: { allow: [appRoot, SHELL_DIR] } },
      };
    },

    // 어댑터로 바꿔 끼운다. 표에 없는 import 는 손대지 않는다.
    resolveId(source, importer) {
      return embedRedirect(source, importer === undefined ? undefined : fileOf(importer));
    },

    // 셸 CSS 는 가두고, 고른 바깥 CSS 는 셸 루트를 피하게 한다.
    transform(code, id) {
      if (!fileOf(id).endsWith('.css')) return null;
      if (isShellStyle(id)) return { code: scopeCss(code, root), map: null };
      if (options.hostCss?.(fileOf(id))) return { code: excludeCss(code, root), map: null };
      return null;
    },
  };
}
