// 본문 인라인 코드 → 볼트 경로 링크의 순수 판정(2026-10-27 오너 요청). 요청·캐시는 useCodePaths.ts, 그리기는 DocLink.tsx 의 InlineCode.
import { CODE_PATH_MAX_BATCH, parseCodePath, parseProvenance, type CodePathHit } from '../../shared/code-path.ts';
import { isTextPath } from '../../shared/text-ext.ts';
import { isHtmlPath } from './frame.ts';

/** 한 요청에 싣는 후보 글자 수 합의 상한. 주소 길이(서버 머리 상한 16 KB)를 넘지 않게 한다. */
export const CODE_PATH_QUERY_BUDGET = 8000;

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** CommonMark 인라인 코드의 앞뒤 빈칸 한 칸 떼기(둘 다 있고 빈칸만이 아닐 때). */
function stripCodeSpace(s: string): string {
  return s.length >= 2 && s.startsWith(' ') && s.endsWith(' ') && s.trim() !== '' ? s.slice(1, -1) : s;
}

/**
 * md 본문의 인라인 코드 글(한 줄 안의 것만). 펜스 코드 블록 안은 건너뛴다. 넉넉히 고르는 것이다 —
 * 실제로 인라인 코드로 그려지는지는 렌더가 정하고(펜스·들여쓰기 코드는 끝에 줄바꿈이 붙어 표에 맞지 않는다), 이 목록은 물을 후보일 뿐이다.
 */
export function inlineCodeSpans(md: string): string[] {
  const out: string[] = [];
  let fence: { ch: string; len: number } | null = null;
  for (const line of md.split('\n')) {
    const f = FENCE.exec(line);
    if (fence !== null) {
      const t = line.trim();
      if (f !== null && f[1]![0] === fence.ch && f[1]!.length >= fence.len && t === f[1]) fence = null;
      continue;
    }
    if (f !== null) {
      fence = { ch: f[1]![0]!, len: f[1]!.length };
      continue;
    }
    let open: string | null = null;
    let start = 0;
    for (const m of line.matchAll(/`+/g)) {
      if (open === null) {
        open = m[0];
        start = m.index + m[0].length;
      } else if (m[0] === open) {
        out.push(stripCodeSpace(line.slice(start, m.index)));
        open = null;
      }
    }
  }
  return out;
}

/**
 * 서버에 물을 후보(겹침 없음, 나온 차례). 개수(200)와 글자 수 합(CODE_PATH_QUERY_BUDGET)에서 자른다.
 * `extra` 는 문서 정보 패널의 경로 후보(meta-links.ts)다 — 본문 것보다 앞에 둔다(몇 안 되고, 같은 요청 하나로 함께 묻는다).
 */
export function codePathCandidates(md: string, extra: readonly string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let budget = CODE_PATH_QUERY_BUDGET;
  for (const s of [...extra, ...inlineCodeSpans(md)]) {
    if (seen.has(s) || (parseCodePath(s) === null && parseProvenance(s) === null)) continue;
    seen.add(s);
    budget -= encodeURIComponent(s).length + 3;
    if (budget < 0 || out.length >= CODE_PATH_MAX_BATCH) break;
    out.push(s);
  }
  return out;
}

/**
 * 찾은 후보를 어디로 여는가. md 는 리더(앵커 유지), 폴더는 폴더 주소, html·텍스트 파일은 앱 안 보기(`:12` 꼬리는 `#L12`),
 * 그 밖(이미지·pdf 등)은 원본을 새 탭으로.
 */
export type CodePathTarget =
  | { kind: 'md'; path: string; anchor: string }
  | { kind: 'app'; path: string; anchor: string }
  | { kind: 'raw'; path: string };

export function codePathTarget(text: string, hit: CodePathHit): CodePathTarget {
  const cp = parseCodePath(text);
  const anchor = cp?.anchor ?? '';
  if (hit.kind === 'folder') return { kind: 'app', path: `${hit.path}/`, anchor: '' };
  if (hit.kind === 'md') return { kind: 'md', path: hit.path, anchor };
  if (isHtmlPath(hit.path)) return { kind: 'app', path: hit.path, anchor };
  if (isTextPath(hit.path)) {
    const line = cp?.line ?? null;
    return { kind: 'app', path: hit.path, anchor: line !== null ? `L${line}` : /^L\d{1,9}$/.test(anchor) ? anchor : '' };
  }
  return { kind: 'raw', path: hit.path };
}
