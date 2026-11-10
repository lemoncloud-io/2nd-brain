// 확장 층의 빌드 계약. 확장 폴더의 `build.ts` 가 defineBuildExtension(...) 을 기본 내보내기로 낸다.
// vite.config.ts(Vite 설정을 읽을 때)와 start.ts(설치 전)가 loadBuildExtension() 으로 읽는다.
// 그래서 이 파일과 확장 build.ts 의 정적 import 는 node 내장과 이 유닛·셸의 의존성 없는 파일뿐이어야 한다.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { EMPTY_UI_FILE, EXT_UI_ID, extDir, extFile } from './ext-locate.ts';

// 확장의 Vite 플러그인이 같은 규칙을 쓰도록 다시 내보낸다(CSS 가두기·React 한 벌).
export { excludeCss, scopeCss } from '../../../project-viewer/config/shell/loader/scope-css.ts';
export { APP_DEDUPE } from './app-embed-plugin.ts';

const appDir = path.dirname(fileURLToPath(import.meta.url));

/** 이 앱 스타일 폴더(끝에 구분자). 확장 CSS 와 서로 닿지 않게 할 때 기준이다. */
export const HOST_STYLES_DIR = path.join(appDir, 'src', 'styles') + path.sep;

/** 이 앱 CSS 파일인가(절대경로, 질의 없이). */
export const hostCss = (file: string): boolean => file.startsWith(HOST_STYLES_DIR);

/** 앱 화면 폴더 하나. dir 은 절대경로, rootClass 기본은 `app-<id>`. */
export type AppEmbedEntry = { id: string; dir: string; rootClass?: string };

/** 확장 build.ts 가 내는 것. 모두 선택이다. */
export interface ViewerBuildExtension {
  /** 뷰어 묶음에 넣을 앱 화면 폴더(appEmbed 하나씩). */
  appEmbeds?: readonly AppEmbedEntry[];
  /** 더할 Vite 플러그인. 코어 플러그인보다 앞에 놓인다. */
  plugins?: readonly unknown[];
  /** start.ts 가 lockfile 기준으로 npm ci 할 폴더(절대경로). */
  installDirs?: readonly string[];
  /** dist 신선도 판정에 더할 경로(절대경로, 폴더는 재귀). */
  watch?: readonly string[];
}

/** 빈 값까지 채운 빌드 확장. */
export type BuildExtension = { appEmbeds: AppEmbedEntry[]; plugins: unknown[]; installDirs: string[]; watch: string[] };

/** 확장 작성용 항등 함수(타입만 잡는다). */
export function defineBuildExtension(ext: ViewerBuildExtension): ViewerBuildExtension {
  return ext;
}

/** 확장이 없을 때의 값. */
export const EMPTY_BUILD_EXTENSION: BuildExtension = { appEmbeds: [], plugins: [], installDirs: [], watch: [] };

/** 모양 검사: 틀리면 그 까닭으로 던진다(코드 실수라 빌드·시작을 멈춘다). 맞으면 빈 값을 채워 돌려준다. */
export function assertBuildExtension(raw: unknown, where = 'build.ts'): BuildExtension {
  if (raw === null || typeof raw !== 'object') throw new Error(`확장 ${where}: 기본 내보내기가 객체가 아니다`);
  const ext = raw as ViewerBuildExtension;
  // 목록 칸은 배열이어야 한다.
  const list = <T>(key: keyof ViewerBuildExtension): T[] => {
    const v = ext[key];
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw new Error(`확장 ${where}: ${key} 가 배열이 아니다`);
    return [...v] as T[];
  };
  const appEmbeds = list<AppEmbedEntry>('appEmbeds');
  const seen = new Set<string>();
  // 앱 화면 폴더: id 문법·중복, 폴더는 절대경로.
  for (const a of appEmbeds) {
    if (!/^[a-z0-9-]+$/.test(a.id)) throw new Error(`확장 ${where}: 앱 id 가 올바르지 않다: ${a.id}`);
    if (seen.has(a.id)) throw new Error(`확장 ${where}: 앱 id 가 겹친다: ${a.id}`);
    seen.add(a.id);
    if (!path.isAbsolute(a.dir)) throw new Error(`확장 ${where}: 앱 ${a.id} 의 dir 이 절대경로가 아니다`);
  }
  const installDirs = list<string>('installDirs');
  const watch = list<string>('watch');
  // 설치·감시 경로도 절대경로만 받는다(기준 폴더가 모호하지 않게).
  for (const p of [...installDirs, ...watch]) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error(`확장 ${where}: 경로가 절대경로가 아니다: ${String(p)}`);
  }
  return { appEmbeds, plugins: list<unknown>('plugins'), installDirs, watch };
}

/** 확장 build.ts 를 읽는다. 확장이나 파일이 없으면 빈 값, 있는데 깨졌으면 던진다. */
export async function loadBuildExtension(env: NodeJS.ProcessEnv = process.env): Promise<BuildExtension> {
  const file = extFile('build.ts', env);
  if (file === null) return EMPTY_BUILD_EXTENSION;
  let mod: { default?: unknown };
  try {
    mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
  } catch (e) {
    throw new Error(`확장 build.ts 를 읽지 못했다(${file}): ${e instanceof Error ? e.message : String(e)}`);
  }
  return assertBuildExtension(mod.default, file);
}

/** Vite 플러그인 중 extVirtual 이 쓰는 부분(구조 타입 — vite 판에 묶이지 않는다). */
export interface ExtVirtualPlugin {
  name: string;
  enforce: 'pre';
  config(config: { root?: string }): { server: { fs: { allow: string[] } } };
  resolveId(source: string): string | null;
}

/**
 * 화면 확장 가상 모듈을 푸는 Vite 플러그인. 확장 ui.ts 가 있으면 그 파일, 없으면 빈 모듈이다.
 * 실제 파일로 풀리므로 개발 서버의 HMR 이 그대로 돈다(파일을 새로 만들거나 지울 때만 재시작).
 */
export function extVirtual(env: NodeJS.ProcessEnv = process.env): ExtVirtualPlugin {
  const dir = extDir(env);
  const ui = extFile('ui.ts', env) ?? EMPTY_UI_FILE;
  return {
    name: 'knowledge-viewer-ext',
    enforce: 'pre',
    // 개발 서버가 확장 폴더(앱 루트 밖)를 읽게 허용한다. allow 를 주면 기본값이 사라지므로 앱 루트도 함께.
    config(config) {
      const appRoot = path.resolve(config.root ?? process.cwd());
      return { server: { fs: { allow: dir === null ? [appRoot] : [appRoot, dir] } } };
    },
    // 가상 id 만 바꾼다. 그 밖은 다른 플러그인·기본 해석에 넘긴다.
    resolveId(source) {
      return source === EXT_UI_ID ? ui : null;
    },
  };
}
