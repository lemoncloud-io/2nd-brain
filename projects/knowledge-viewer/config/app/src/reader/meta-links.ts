// 문서 정보 패널의 frontmatter 값 → 글·링크 조각. 순수 모듈이다(2026-10-27 오너 요청). 그리기는 MetaPanel.tsx.
// 위키링크는 doc.links(서버가 frontmatter 머리의 `[[…]]` 까지 풀어 둔 것)로, 경로·md 링크는 /api/resolve-paths(useCodePaths 와 같은 요청)로 푼다.
// URL·`$GITHUB_DIR/<owner>/<repo>` 는 바깥 링크다 — 누르기 전에는 아무 요청도 없다.
import { parseCodePath, parseProvenance } from '../../shared/code-path.ts';
import { splitWikiTarget } from '../../shared/wikitarget.ts';
import { resolveRelative } from './relpath.ts';

export type MetaSeg =
  | { kind: 'text'; text: string }
  /** `[[대상#앵커|별칭]]`. text 는 별칭, 없으면 괄호 안(별칭 뺀 것). target·anchor 는 splitWikiTarget 그대로 — doc.links 와 맞춘다. */
  | { kind: 'wiki'; text: string; target: string; anchor: string }
  /** `[글](상대 경로)`. target 은 부호를 푼 경로(앵커 뺀 것). 문서 폴더 기준으로만 푼다(본문 md 링크와 같다). */
  | { kind: 'md'; text: string; target: string; anchor: string }
  /** 맨 볼트 경로(`raw/x.md`·`projects/a/b.md`), 또는 값 전체인 출처 문자열(`raw/빈칸 든 이름.md`). /api/resolve-paths 후보 그대로다. */
  | { kind: 'path'; text: string }
  | { kind: 'url'; text: string; url: string };

/** 패널이 보이는 frontmatter 키(차례대로). */
export const META_KEYS = ['type', 'status', 'aliases', 'related', 'sources'] as const;

/** 패널 한 줄. parse 가 false 면(문자열이 아니던 값) 글 그대로 그린다. */
export type MetaItem = { text: string; parse: boolean };

/** frontmatter 값을 줄 목록으로 편다. 없으면 빈 배열이다. 문자열만 링크를 읽는다. */
export function metaItems(v: unknown): MetaItem[] {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v.flatMap(metaItems);
  if (typeof v === 'object') return [{ text: JSON.stringify(v), parse: false }];
  return [{ text: String(v), parse: typeof v === 'string' }];
}

// 위키링크(본문 규칙과 같은 `[^[\]]`) 또는 md 링크 `[글](주소)`(주소에 빈칸·괄호 없음).
const LINKS = /\[\[([^[\]]+?)\]\]|\[([^[\]]+)\]\(([^()\s]+)\)/g;
const NAME = /^[A-Za-z0-9_.-]+$/;
const GITHUB_DIR = '$GITHUB_DIR/';

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const httpUrl = (s: string): string | null => {
  if (!/^https?:\/\/\S+$/i.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
};

/** `$GITHUB_DIR/<owner>/<repo>[/<경로>]` → GitHub 주소. owner·repo 가 이름 글자가 아니면 null. */
export function githubDirUrl(token: string): string | null {
  if (!token.startsWith(GITHUB_DIR)) return null;
  const [owner, repo, ...rest] = token.slice(GITHUB_DIR.length).split('/');
  if (owner === undefined || repo === undefined) return null;
  if (!NAME.test(owner) || !NAME.test(repo) || /^\.+$/.test(owner) || /^\.+$/.test(repo)) return null;
  const segs = rest.filter((s) => s !== '');
  const base = `https://github.com/${owner}/${repo}`;
  return segs.length === 0 ? base : `${base}/tree/HEAD/${segs.map(encodeURIComponent).join('/')}`;
}

/** 낱말 앞뒤에 붙은 괄호·따옴표·문장 부호는 링크 밖 글로 둔다. */
function trimToken(tok: string): [string, string, string] {
  const lead = /^[("'`<[]*/.exec(tok)![0];
  let core = tok.slice(lead.length);
  const trail = /[)"'`>\],.;:!?]*$/.exec(core)![0];
  core = core.slice(0, core.length - trail.length);
  return [lead, core, trail];
}

/** 링크가 아닌 글 조각에서 URL·`$GITHUB_DIR`·볼트 경로 낱말을 찾는다. 빈칸은 그대로 남긴다. */
function scanPlain(text: string, out: MetaSeg[]): void {
  for (const part of text.split(/(\s+)/)) {
    if (part === '') continue;
    if (/^\s+$/.test(part)) {
      out.push({ kind: 'text', text: part });
      continue;
    }
    const [lead, core, trail] = trimToken(part);
    const url = core === '' ? null : (httpUrl(core) ?? githubDirUrl(core));
    if (url !== null) out.push({ kind: 'text', text: lead }, { kind: 'url', text: core, url }, { kind: 'text', text: trail });
    else if (core !== '' && parseCodePath(core) !== null) out.push({ kind: 'text', text: lead }, { kind: 'path', text: core }, { kind: 'text', text: trail });
    else out.push({ kind: 'text', text: part });
  }
}

/** 붙은 text 조각을 합치고 빈 것을 뺀다. */
function merge(segs: MetaSeg[]): MetaSeg[] {
  const out: MetaSeg[] = [];
  for (const s of segs) {
    if (s.kind === 'text') {
      if (s.text === '') continue;
      const last = out[out.length - 1];
      if (last !== undefined && last.kind === 'text') {
        out[out.length - 1] = { kind: 'text', text: last.text + s.text };
        continue;
      }
    }
    out.push(s);
  }
  return out;
}

/** frontmatter 문자열 하나를 조각으로 나눈다. 링크가 없으면 text 하나다. */
export function parseMetaValue(value: string): MetaSeg[] {
  // 값 전체가 출처 문자열이면(원본 이름엔 빈칸·괄호가 든다) 낱말로 쪼개지 않고 경로 하나로 본다.
  const [lead, core, trail] = trimToken(value);
  if (parseCodePath(core) === null && parseProvenance(core) !== null) {
    return merge([{ kind: 'text', text: lead }, { kind: 'path', text: core }, { kind: 'text', text: trail }]);
  }
  const out: MetaSeg[] = [];
  let at = 0;
  LINKS.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINKS.exec(value)) !== null) {
    scanPlain(value.slice(at, m.index), out);
    at = m.index + m[0].length;
    if (m[1] !== undefined) {
      const w = splitWikiTarget(m[1]);
      const bar = m[1].indexOf('|');
      const shown = bar === -1 ? m[1].trim() : w.label;
      if (w.target === '') out.push({ kind: 'text', text: m[0] });
      else out.push({ kind: 'wiki', text: shown, target: w.target, anchor: w.anchor ?? '' });
      continue;
    }
    const label = m[2]!;
    const href = m[3]!;
    const url = httpUrl(href);
    if (url !== null) {
      out.push({ kind: 'url', text: label, url });
      continue;
    }
    // 스킴(mailto: 등)·`//`·`#` 만 있는 주소는 링크로 읽지 않는다 — 글자만 남긴다.
    const h = href.indexOf('#');
    const target = safeDecode(h === -1 ? href : href.slice(0, h));
    if (target === '' || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
      out.push({ kind: 'text', text: label });
      continue;
    }
    out.push({ kind: 'md', text: label, target, anchor: h === -1 ? '' : safeDecode(href.slice(h + 1)) });
  }
  scanPlain(value.slice(at), out);
  return merge(out);
}

/** /api/resolve-paths 에 물을 후보(겹침 없음, 나온 차례). md 링크는 경로 후보 규칙(parseCodePath)을 지나는 것만. */
export function metaPathCandidates(frontmatter: Record<string, unknown>, keys: readonly string[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    for (const item of metaItems(frontmatter[k])) {
      if (!item.parse) continue;
      for (const s of parseMetaValue(item.text)) {
        const c = s.kind === 'path' ? s.text : s.kind === 'md' ? s.target : null;
        if (c !== null && !out.includes(c) && (parseCodePath(c) !== null || parseProvenance(c) !== null)) out.push(c);
      }
    }
  }
  return out;
}

/**
 * md 링크의 찾은 곳을 본문 md 링크 규칙(문서 폴더 기준만)으로 거른다. resolve-paths 는 루트 기준으로도 찾으므로,
 * 문서 폴더 기준 경로와 같을 때만 받는다(끝 `/` 는 폴더).
 */
export function mdLinkAccepts(docPath: string, target: string, hitPath: string): boolean {
  const rel = resolveRelative(docPath, target);
  return rel !== null && rel.replace(/\/+$/, '') === hitPath;
}
