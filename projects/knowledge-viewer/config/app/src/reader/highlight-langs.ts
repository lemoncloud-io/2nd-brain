// 구문 강조 언어 표. 확장자·펜스 정보 문자열 → highlight.js 언어 id, 언어 id → 지연 import.
// DOM·hljs 를 만지지 않는 순수 표다. 모르는 언어는 null — 지금처럼 단색으로 그린다.

/** 1차 지원 언어(highlight.js 언어 모듈 이름). html 은 xml, toml 은 ini 모듈이 맡는다. */
export type HlLang =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'json'
  | 'yaml'
  | 'bash'
  | 'css'
  | 'xml'
  | 'markdown'
  | 'sql'
  | 'go'
  | 'java'
  | 'diff'
  | 'ini'
  | 'dockerfile';

/** 언어 모듈 지연 import. 경로가 글자 그대로여야 Vite 가 언어마다 청크를 나눈다. */
export const LANG_LOADERS: Record<HlLang, () => Promise<{ default: unknown }>> = {
  typescript: () => import('highlight.js/lib/languages/typescript'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  python: () => import('highlight.js/lib/languages/python'),
  json: () => import('highlight.js/lib/languages/json'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  bash: () => import('highlight.js/lib/languages/bash'),
  css: () => import('highlight.js/lib/languages/css'),
  xml: () => import('highlight.js/lib/languages/xml'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  sql: () => import('highlight.js/lib/languages/sql'),
  go: () => import('highlight.js/lib/languages/go'),
  java: () => import('highlight.js/lib/languages/java'),
  diff: () => import('highlight.js/lib/languages/diff'),
  ini: () => import('highlight.js/lib/languages/ini'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
};

/** 지원 언어 목록(표시·시험용). */
export const HL_LANGS = Object.keys(LANG_LOADERS) as HlLang[];

// 파일 확장자(소문자, 점 없이) → 언어. md 는 파일 보기에서 강조하지 않는다(리더가 따로 그린다).
const EXT: Record<string, HlLang> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  json: 'json',
  jsonc: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  css: 'css',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  sql: 'sql',
  go: 'go',
  java: 'java',
  diff: 'diff',
  patch: 'diff',
  toml: 'ini',
  ini: 'ini',
};

// 펜스 정보 문자열(소문자) → 언어. 언어 id 자신도 받는다.
const FENCE: Record<string, HlLang> = {
  ...(Object.fromEntries(Object.keys(LANG_LOADERS).map((l) => [l, l])) as Record<string, HlLang>),
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  node: 'javascript',
  py: 'python',
  python3: 'python',
  jsonc: 'json',
  json5: 'json',
  yml: 'yaml',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  shellsession: 'bash',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  md: 'markdown',
  golang: 'go',
  patch: 'diff',
  toml: 'ini',
  docker: 'dockerfile',
};

/** 파일 경로 → 언어. `Dockerfile`(·`Dockerfile.dev`·`x.dockerfile`)도 받는다. md·모르는 확장자는 null. */
export function langOfPath(path: string): HlLang | null {
  const name = (path.split('/').pop() ?? '').toLowerCase();
  // Dockerfile 은 확장자가 아니라 이름으로 정한다.
  if (name === 'dockerfile' || name.startsWith('dockerfile.') || name.endsWith('.dockerfile')) return 'dockerfile';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1);
  return Object.hasOwn(EXT, ext) ? EXT[ext]! : null;
}

/** 펜스 정보 문자열(`ts`·`Python`·`console` …) → 언어. mermaid·모르는 값·빈 값은 null. */
export function langOfFence(info: string | null | undefined): HlLang | null {
  const key = (info ?? '').trim().toLowerCase();
  return key !== '' && Object.hasOwn(FENCE, key) ? FENCE[key]! : null;
}

/** `language-ts` 같은 클래스 목록(hast 배열 또는 문자열)에서 언어. */
export function langOfClassName(className: unknown): HlLang | null {
  const list: unknown[] = Array.isArray(className) ? className : typeof className === 'string' ? className.split(/\s+/) : [];
  // 첫 language-* 클래스만 본다(remark 가 하나만 단다).
  for (const c of list) if (typeof c === 'string' && c.startsWith('language-')) return langOfFence(c.slice('language-'.length));
  return null;
}
