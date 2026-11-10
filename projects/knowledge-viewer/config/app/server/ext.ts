// 확장 층의 서버 계약. 확장 폴더의 `server.ts` 가 defineServerExtension(...) 을 기본 내보내기로 낸다.
// 서버 시작(runCli)이 loadServerExtension() 으로 한 번 읽는다. 깨졌으면 시작을 멈춘다(코드 실수다).
import { pathToFileURL } from 'node:url';

import type { Source } from '../shared/source.ts';
import { extFile } from '../ext-locate.ts';
import { assertApps, type ViewerApp } from './apps/registry.ts';
import type { ApiResult } from './handlers.ts';
import type { SourceReader } from './source.ts';

/** 확장 API 가 받는 것. readSource 는 `?src=` 를 읽어 그 소스의 읽기 도구를 준다(틀리면 오류 응답). */
export type ExtApiContext = {
  includePrivate: boolean;
  readSource(url: URL): Promise<{ src: Source; reader: SourceReader } | ApiResult>;
};

/** 확장 API 경로 하나. GET·HEAD 만 온다(바깥 관문이 거른다). */
export type ExtApiRoute = { path: string; handle(ctx: ExtApiContext, url: URL): Promise<ApiResult> };

/** 확장 server.ts 가 내는 것. 모두 선택이다. */
export interface ViewerServerExtension {
  /** 앱 플러그인(/apps/<id>, /api/apps/<id>/*). */
  apps?: readonly ViewerApp[];
  /** 코어에 없는 /api 경로. 코어 경로가 늘 이긴다. */
  api?: readonly ExtApiRoute[];
}

/** 빈 값까지 채운 서버 확장. */
export type ServerExtension = { apps: ViewerApp[]; api: ExtApiRoute[] };

/** 확장 작성용 항등 함수(타입만 잡는다). */
export function defineServerExtension(ext: ViewerServerExtension): ViewerServerExtension {
  return ext;
}

/** 확장이 없을 때의 값. */
export const EMPTY_SERVER_EXTENSION: ServerExtension = { apps: [], api: [] };

/** 확장 API 경로 문법: `/api/` 아래 소문자·숫자·하이픈 조각. */
export const EXT_API_PATH = /^\/api\/[a-z0-9-]+(\/[a-z0-9-]+)*$/;

/** 확장이 쓸 수 없는 접두(코어가 아래 경로를 통째로 쓴다). */
export const CORE_API_PREFIXES = ['/api/apps', '/api/panels', '/api/events', '/api/graph', '/api/pr'];

/** 확장 API 검사: 문법·코어 경로·코어 접두·중복. 틀리면 던진다. */
export function assertExtApi(routes: readonly ExtApiRoute[], corePaths: readonly string[]): void {
  const seen = new Set<string>();
  for (const r of routes) {
    if (typeof r.path !== 'string' || !EXT_API_PATH.test(r.path)) throw new Error(`확장 API 경로가 올바르지 않다: ${String(r.path)}`);
    if (corePaths.includes(r.path)) throw new Error(`확장 API 경로가 코어와 겹친다: ${r.path}`);
    if (CORE_API_PREFIXES.some((p) => r.path === p || r.path.startsWith(`${p}/`))) throw new Error(`확장 API 경로가 코어 접두 아래다: ${r.path}`);
    if (seen.has(r.path)) throw new Error(`확장 API 경로가 겹친다: ${r.path}`);
    if (typeof r.handle !== 'function') throw new Error(`확장 API ${r.path} 에 handle 이 없다`);
    seen.add(r.path);
  }
}

/** 모양 검사 뒤 빈 값을 채운다. 앱 등록부 검사(id 문법·중복)도 여기서 한다. */
export function assertServerExtension(raw: unknown, corePaths: readonly string[], where = 'server.ts'): ServerExtension {
  if (raw === null || typeof raw !== 'object') throw new Error(`확장 ${where}: 기본 내보내기가 객체가 아니다`);
  const ext = raw as ViewerServerExtension;
  // 두 칸 모두 배열이어야 한다.
  if (ext.apps !== undefined && !Array.isArray(ext.apps)) throw new Error(`확장 ${where}: apps 가 배열이 아니다`);
  if (ext.api !== undefined && !Array.isArray(ext.api)) throw new Error(`확장 ${where}: api 가 배열이 아니다`);
  const apps = [...(ext.apps ?? [])];
  const api = [...(ext.api ?? [])];
  assertApps(apps);
  assertExtApi(api, corePaths);
  return { apps, api };
}

/** 확장 server.ts 를 읽는다. 확장이나 파일이 없으면 빈 값, 있는데 깨졌으면 던진다. */
export async function loadServerExtension(corePaths: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<ServerExtension> {
  const file = extFile('server.ts', env);
  if (file === null) return EMPTY_SERVER_EXTENSION;
  let mod: { default?: unknown };
  try {
    mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
  } catch (e) {
    throw new Error(`확장 server.ts 를 읽지 못했다(${file}): ${e instanceof Error ? e.message : String(e)}`);
  }
  return assertServerExtension(mod.default, corePaths, file);
}
