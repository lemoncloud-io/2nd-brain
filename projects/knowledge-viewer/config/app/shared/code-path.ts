// 인라인 코드가 볼트 경로 후보인가, 후보를 어느 경로로 차례로 찾는가. 순수 모듈이다(2026-10-27 오너 요청).
// 화면(useCodePaths 가 후보를 고른다)과 서버(/api/resolve-paths 가 입력을 다시 검사한다)가 같은 규칙을 쓴다.
import { TEXT_EXTS } from './text-ext.ts';

/** 후보 하나의 최대 길이(글자). */
export const CODE_PATH_MAX_LEN = 300;
/** 한 요청의 최대 후보 수. 넘는 것은 서버가 버린다(truncated). */
export const CODE_PATH_MAX_BATCH = 200;

/** 꼬리 확장자만으로 후보가 되는 것(소문자, 점 없이). `/` 가 있으면 확장자가 없어도 후보다. */
const PATH_EXTS: ReadonlySet<string> = new Set([
  ...TEXT_EXTS,
  'md', 'html', 'htm', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'pdf',
]);

export type CodePath = {
  /** 앵커·줄 꼬리를 뗀 경로(끝 `/` 없이). 아직 문서 기준인지 루트 기준인지 모른다. */
  rel: string;
  /** `#` 뒤. 없으면 빈 문자열. */
  anchor: string;
  /** `:12`·`:12:3` 꼬리의 줄 번호. 없으면 null. */
  line: number | null;
  /** 끝이 `/` 였다 — 폴더로만 찾는다. */
  folder: boolean;
};

export type CodePathKind = 'md' | 'file' | 'folder';
/** 서버가 찾은 곳. 폴더면 path 끝에 `/` 가 없다. */
export type CodePathHit = { path: string; kind: CodePathKind };
export type ResolvePathsResponse = {
  source: string;
  from: string;
  paths: Record<string, CodePathHit | null>;
  /** 후보가 상한(CODE_PATH_MAX_BATCH)을 넘어 뒤를 버렸다. */
  truncated?: boolean;
};

/** 꼬리 확장자가 PATH_EXTS 에 있는가. 점으로 시작하는 이름(`.env`)은 확장자가 없다고 본다. */
function hasPathExt(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot > 0 && PATH_EXTS.has(name.slice(dot + 1).toLowerCase());
}

/**
 * 인라인 코드 글이 볼트 경로 후보면 그 조각을, 아니면 null 을 준다.
 * 빈칸 없음 · URL·mailto 아님 · glob 글자(`*?[]{}<>|`)·따옴표·명령 기호 없음 · 300자 이하 ·
 * `/` 가 있거나 아는 확장자로 끝남. 절대 경로(`/…`·`~…`)는 기계 경로라 후보가 아니다.
 */
export function parseCodePath(text: string): CodePath | null {
  if (text === '' || text.length > CODE_PATH_MAX_LEN) return null;
  if (/\s/.test(text)) return null;
  if (text.includes('://') || /^mailto:/i.test(text)) return null;
  if (/[*?[\]{}<>|]/.test(text)) return null;
  if (/["'`\\$=,;()!&^%+]/.test(text)) return null;
  if (text.startsWith('/') || text.startsWith('~') || text.startsWith('-')) return null;
  let head = text;
  let anchor = '';
  const h = head.indexOf('#');
  if (h !== -1) {
    anchor = head.slice(h + 1);
    head = head.slice(0, h);
  }
  let line: number | null = null;
  const m = /:(\d{1,9})(?::\d{1,9})?$/.exec(head);
  if (m !== null) {
    line = Number(m[1]);
    head = head.slice(0, m.index);
  }
  // 남은 `:` 는 경로가 아니다(`pr:12`·`npm:x/y`·`C:\…`).
  if (head === '' || head.includes(':')) return null;
  const folder = head.endsWith('/');
  const rel = folder ? head.slice(0, -1) : head;
  if (rel === '' || rel.split('/').some((s) => s === '')) return null;
  if (!folder && !rel.includes('/') && !hasPathExt(rel)) return null;
  return { rel, anchor, line, folder };
}

/**
 * 출처 문자열(`raw/<파일>.md`·`archive/<…>.md`, 볼트 루트 기준)이면 그 경로를, 아니면 null 을 준다(2026-10-27 오너 요청).
 * 원본 파일 이름은 제목이라 빈칸·따옴표·괄호·`:`·`#` 이 든다 — parseCodePath 가 버리는 것이라 따로 본다. 앵커·줄 꼬리는 없다.
 * 300자 이하, 앞뒤 빈칸·제어 글자·`\` 없음, 빈 조각·`.`·`..` 조각 없음.
 */
export function parseProvenance(text: string): string | null {
  if (text.length > CODE_PATH_MAX_LEN || text !== text.trim()) return null;
  if (!/^(raw|archive)\/.+\.md$/.test(text) || /[\u0000-\u001f\u007f\\]/.test(text)) return null;
  return text.split('/').some((s) => s === '' || s === '.' || s === '..' || s !== s.trim()) ? null : text;
}

/** 확장자가 있어 파일로 먼저 찾을 만한가. 없으면(`a/b`) 파일과 폴더 둘 다 본다. */
export function looksLikeFile(rel: string): boolean {
  return hasPathExt(rel.split('/').pop() ?? '');
}

/** 조각 `base` 아래에 `rel` 을 붙여 정규화한다. 루트 위로 나가거나 루트 자체가 되면 null. */
function joinVault(base: readonly string[], rel: string): string | null {
  const segs = [...base];
  for (const s of rel.split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') {
      if (segs.length === 0) return null;
      segs.pop();
    } else segs.push(s);
  }
  return segs.length === 0 ? null : segs.join('/');
}

/** 루트 기준으로도 찾을 만한가 — 실제 조각(빈 조각·`.` 제외, 끝 `/` 는 조각이 아니다)이 둘 이상이어야 한다. */
export function rootFallbackAllowed(rel: string): boolean {
  return rel.split('/').filter((s) => s !== '' && s !== '.').length >= 2;
}

/**
 * 후보를 찾을 볼트 경로들, 찾는 차례대로. (1) 지금 문서의 폴더 기준, (2) 볼트 루트 기준. 같으면 하나다.
 * 루트 기준은 조각이 둘 이상일 때만이다(`wiki/INDEX.md` 는 되고 `package.json`·`CLAUDE.md`·`docs/` 는 안 된다) —
 * 외부 저장소를 말하는 맨 이름이 볼트 루트의 엉뚱한 파일로 이어지지 않게 한다(2026-10-27 코디네이터 결정).
 * 루트에 있는 문서는 문서 폴더가 곧 루트라 맨 이름도 찾는다. `..` 로 볼트 밖에 나가는 것은 뺀다.
 * `from` 이 비었거나 이상하면(빈 조각·`..`) 문서 폴더가 없다고 보고 루트 기준만 본다(같은 조각 규칙).
 */
export function codePathProbes(from: string, rel: string): string[] {
  const fromSegs = from.split('/');
  const dir = fromSegs.some((s) => s === '' || s === '.' || s === '..') ? null : fromSegs.slice(0, -1);
  const rootOk = rootFallbackAllowed(rel);
  const bases: string[][] = [];
  if (dir !== null) bases.push(dir);
  if (rootOk && (dir === null || dir.length > 0)) bases.push([]);
  const out: string[] = [];
  for (const base of bases) {
    const p = joinVault(base, rel);
    if (p !== null && !out.includes(p)) out.push(p);
  }
  return out;
}
