// 근거 참조 1건을 파일 본문에 대해 해소한다. 파일을 읽지 않는 순수 함수다.
import type { Heading } from './types.ts';

export interface RefShape {
  at?: string;
  lines?: string;
  find?: string;
}
export type ResolveOk = { ok: true; slug: string | undefined; line: number | undefined };
export type ResolveFail = { ok: false; reason: string };
export type ResolveResult = ResolveOk | ResolveFail;

const LINES = /^(\d+)(?:-(\d+))?$/;

/** 줄 번호 위쪽에서 가장 가까운 헤딩. 첫 헤딩보다 위면 undefined. */
function headingAbove(headings: Heading[], line: number): string | undefined {
  let found: string | undefined;
  for (const h of headings) {
    if (h.line <= line) found = h.slug;
    else break;
  }
  return found;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/**
 * 인라인 표기를 뗀다. `at`은 헤딩의 평문(mdast 평문화)과 견주므로,
 * 표기만 다른 `at`을 알아보고 힌트를 주는 데 쓴다.
 */
export function stripInlineMarkup(s: string): string {
  return s
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(s: string): string[] {
  const t = s.replace(/\s+/g, '');
  const out: string[] = [];
  for (let i = 0; i + 1 < t.length; i += 1) out.push(t.slice(i, i + 2));
  return out;
}

/** 공백을 뗀 문자열의 문자 바이그램 Dice 계수. 바이그램이 없으면 같은지만 본다. */
function dice(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.length === 0 || right.length === 0) {
    return a.replace(/\s+/g, '') === b.replace(/\s+/g, '') ? 1 : 0;
  }
  const pool = new Map<string, number>();
  for (const g of left) pool.set(g, (pool.get(g) ?? 0) + 1);
  let hit = 0;
  for (const g of right) {
    const left0 = pool.get(g) ?? 0;
    if (left0 > 0) {
      pool.set(g, left0 - 1);
      hit += 1;
    }
  }
  return (2 * hit) / (left.length + right.length);
}

/** `want`와 닮은 헤딩. 0.5 이상만, 점수 내림차순·동점이면 문서 순서. */
export function nearestHeadings(want: string, headings: Heading[], max = 2): Heading[] {
  return headings
    .map((heading, index) => ({ heading, index, score: dice(want, heading.text) }))
    .filter((c) => c.score >= 0.5)
    .sort((x, y) => y.score - x.score || x.index - y.index)
    .slice(0, max)
    .map((c) => c.heading);
}

/** 맞는 헤딩이 0건일 때 덧붙이는 힌트. 표기 차이가 먼저고, 아니면 닮은 헤딩이다. */
function missHint(want: string, headings: Heading[]): string {
  const plain = stripInlineMarkup(want);
  const same = headings.filter((h) => h.text === plain);
  if (same.length === 1) {
    return ` — 표기를 뗀 "${same[0]!.text}"이 있다. at은 헤딩의 평문과 비교한다(백틱·굵게·링크 표기 제거)`;
  }
  const near = nearestHeadings(want, headings);
  if (near.length === 0) return '';
  return ` — 가까운 헤딩: ${near.map((h) => `"${h.text}"`).join(', ')}`;
}

/**
 * `body`는 원문 전체(frontmatter 포함)이고 `headings`의 줄 번호도 원문 기준이어야 한다.
 * `lines`는 "파일 줄 수" 기준이고 `find`는 코드펜스 안까지 찾기 때문이다.
 */
export function resolveRef(ref: RefShape, body: string, headings: Heading[]): ResolveResult {
  const given = [ref.at, ref.lines, ref.find].filter((v) => v !== undefined);
  if (given.length > 1) return { ok: false, reason: 'at·lines·find는 함께 쓸 수 없다' };

  if (ref.at !== undefined) {
    const want = ref.at.trim();
    const hits = headings.filter((h) => h.text === want);
    if (hits.length === 0) return { ok: false, reason: `그런 헤딩이 없다: ${want}${missHint(want, headings)}` };
    if (hits.length > 1) return { ok: false, reason: `같은 문구의 헤딩이 ${hits.length}개다: ${want}` };
    return { ok: true, slug: hits[0]!.slug, line: hits[0]!.line };
  }

  if (ref.lines !== undefined) {
    const m = LINES.exec(ref.lines.trim());
    if (!m) return { ok: false, reason: `줄 범위 형식이 아니다: ${ref.lines}` };
    const start = Number(m[1]);
    const end = m[2] === undefined ? start : Number(m[2]);
    const total = body.split('\n').length - (body.endsWith('\n') ? 1 : 0);
    if (start < 1 || start > end || end > total) {
      return { ok: false, reason: `줄 범위가 파일(1-${total}) 밖이다: ${ref.lines}` };
    }
    return { ok: true, slug: headingAbove(headings, start), line: start };
  }

  if (ref.find !== undefined) {
    if (ref.find.length === 0) return { ok: false, reason: 'find가 빈 문자열이다' };
    let count = 0;
    let first = -1;
    let at = body.indexOf(ref.find);
    while (at !== -1) {
      if (first === -1) first = at;
      count += 1;
      if (count > 1) break;
      at = body.indexOf(ref.find, at + 1);
    }
    if (count === 0) return { ok: false, reason: `원문에 0번 나온다: ${ref.find}` };
    if (count > 1) return { ok: false, reason: `원문에 2번 이상 나온다: ${ref.find}` };
    const line = lineOf(body, first);
    return { ok: true, slug: headingAbove(headings, line), line };
  }

  return { ok: true, slug: undefined, line: undefined };
}
