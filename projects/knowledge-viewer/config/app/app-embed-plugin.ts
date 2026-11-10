// 앱 플러그인 화면을 뷰어 묶음에 넣는 Vite 플러그인. 앱 하나에 하나씩 쓴다(vite.config.ts).
//  1. 스타일 격리: 앱 폴더(dir) 아래 CSS 는 `.<rootClass>` 아래로 가두고, 뷰어 CSS(hostCss 가 고른 파일)는 그 안에 닿지 않게 한다.
//  2. 한 벌 맞추기: React 는 뷰어 것 하나로 푼다(resolve.dedupe) — 두 벌이면 훅이 깨진다. 그 밖 의존성은 앱 폴더 node_modules 에서 온다.
//  3. 개발 서버가 앱 폴더(뷰어 루트 밖)를 읽게 허용한다.
// 셸의 projectViewerEmbed 와 같은 모양이고 CSS 변환은 셸의 scope-css.ts 를 그대로 쓴다. 앱 단독 빌드는 이 플러그인을 쓰지 않는다.
// 런타임 import 는 node 내장과 scope-css(의존성 없음)뿐이라 앱 node_modules 가 없어도 설정이 읽힌다.
import path from 'node:path';

import { excludeCss, scopeCss } from '../../../project-viewer/config/shell/loader/scope-css.ts';

/** 앱과 뷰어가 한 벌로 써야 하는 패키지. */
export const APP_DEDUPE = ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client'];

export interface AppEmbedOptions {
  /** 앱 id(등록부와 같다). 플러그인 이름에 쓴다. */
  id: string;
  /** 앱 화면 소스 폴더(절대경로). 이 아래 CSS 가 갇힌다. */
  dir: string;
  /** 앱 루트 클래스(점 없이). 화면 등록부의 appRootClass(id) 와 같아야 한다. */
  rootClass: string;
  /** 뷰어 CSS 중 앱 루트 안에 닿지 않게 할 파일인가(절대경로, 질의 없이). 없으면 뷰어 CSS 는 그대로다. */
  hostCss?: (file: string) => boolean;
}

/** Vite 플러그인 중 이 플러그인이 쓰는 부분(구조 타입 — vite 판에 묶이지 않는다). */
export interface AppEmbedPlugin {
  name: string;
  enforce: 'pre';
  config(config: { root?: string }): { resolve: { dedupe: string[] }; server: { fs: { allow: string[] } } };
  transform(code: string, id: string): { code: string; map: null } | null;
}

/** Vite 모듈 id 에서 질의·해시를 뗀 파일 경로. */
function fileOf(id: string): string {
  return id.split('?')[0]!.split('#')[0]!;
}

/** 파일이 폴더 안인가(폴더 자신·이름이 겹치는 형제 폴더는 아니다). */
function isInside(dir: string, file: string): boolean {
  const rel = path.relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** 앱 CSS 를 루트 아래로 가두는 변환(순수). 시험이 직접 부른다. */
export function scopeAppCss(css: string, rootClass: string): string {
  return scopeCss(css, `.${rootClass}`);
}

/** 뷰어 CSS 가 앱 루트 안을 피하게 하는 변환(순수). */
export function excludeAppCss(css: string, rootClass: string): string {
  return excludeCss(css, `.${rootClass}`);
}

export function appEmbed(options: AppEmbedOptions): AppEmbedPlugin {
  // 루트 클래스·id 는 선택자·이름으로 그대로 쓰므로 문법을 먼저 본다.
  if (!/^[a-z0-9-]+$/.test(options.id)) throw new Error(`appEmbed: 앱 id 가 올바르지 않다: ${options.id}`);
  if (!/^[a-z][a-z0-9-]*$/.test(options.rootClass)) throw new Error(`appEmbed: 루트 클래스가 올바르지 않다: ${options.rootClass}`);
  const dir = path.resolve(options.dir);
  return {
    name: `app-embed-${options.id}`,
    enforce: 'pre',

    // React 를 뷰어 한 벌로. 개발 서버가 앱 폴더를 읽게 허용한다(뷰어 루트도 함께 — allow 를 주면 기본값이 사라진다).
    config(config) {
      const appRoot = path.resolve(config.root ?? process.cwd());
      return { resolve: { dedupe: [...APP_DEDUPE] }, server: { fs: { allow: [appRoot, dir] } } };
    },

    // 앱 CSS 는 가두고, 고른 뷰어 CSS 는 앱 루트를 피하게 한다. 그 밖은 손대지 않는다.
    transform(code, id) {
      const file = fileOf(id);
      if (!file.endsWith('.css')) return null;
      if (isInside(dir, file)) return { code: scopeAppCss(code, options.rootClass), map: null };
      if (options.hostCss?.(file)) return { code: excludeAppCss(code, options.rootClass), map: null };
      return null;
    },
  };
}
