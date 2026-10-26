// 화면 테마 설정: 테마 id 와 밝기(auto·light·dark). 모르는 값은 기본으로 읽고 쓴다.
import { readKey, writeKey } from './storage.ts';
import { DEFAULT_SCHEME, DEFAULT_THEME, findTheme, isScheme, type Scheme } from '../themes.ts';

const THEME_KEY = 'knowledge-viewer.theme';
const SCHEME_KEY = 'knowledge-viewer.scheme';

/** 저장된 테마 id. 없거나 모르는 id 면 기본(vault). */
export function readTheme(): string {
  const raw = readKey(THEME_KEY);
  return raw === null ? DEFAULT_THEME : findTheme(raw).id;
}

export function writeTheme(id: string): void {
  writeKey(THEME_KEY, findTheme(id).id);
}

/** 저장된 밝기. 없거나 모르는 값이면 auto(OS 설정). */
export function readScheme(): Scheme {
  const raw = readKey(SCHEME_KEY);
  return isScheme(raw) ? raw : DEFAULT_SCHEME;
}

export function writeScheme(s: Scheme): void {
  writeKey(SCHEME_KEY, isScheme(s) ? s : DEFAULT_SCHEME);
}
