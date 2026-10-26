// 브라우저가 가진 제목·경로 목록을 즉시 맞춘다. 순수 함수다.
// 등급: 접두 > 단어 시작 > 포함. 초성(자음)으로만 맞은 자리는 같은 등급에서 initialPenalty 만큼 낮다.
// 여러 단어는 AND 이고 점수는 합이다. 범위는 코드포인트 단위다(Highlight 가 같은 단위로 자른다).
import { charMatches, foldChars } from './hangul.ts';

export type Range = [start: number, end: number];
export type TitleMatch = { score: number; ranges: Range[] };

export const SCORE = { prefix: 100, word: 80, contains: 60, initialPenalty: 50 } as const;

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** 본문 하나를 글자 배열과 "이 자리가 단어 시작인가" 표로 미리 풀어 둔다. 목록은 바뀌지 않으니 한 번만 한다. */
export type PreparedText = { chars: string[]; wordStart: boolean[] };

export function prepareText(text: string): PreparedText {
  const chars = foldChars(text);
  const wordStart = chars.map((_, i) => i === 0 || !WORD_CHAR.test(chars[i - 1]!));
  return { chars, wordStart };
}

/** 단어 하나를 본문에서 찾는다. 자리마다 등급을 매겨 가장 높은 것을 돌려준다. */
function matchTerm(term: string[], text: PreparedText): { score: number; range: Range } | null {
  const m = term.length;
  const { chars, wordStart } = text;
  const n = chars.length;
  let best: { score: number; range: Range } | null = null;
  for (let i = 0; i + m <= n; i++) {
    let initial = false;
    let ok = true;
    for (let j = 0; j < m; j++) {
      const r = charMatches(term[j]!, chars[i + j]!);
      if (r === null) {
        ok = false;
        break;
      }
      if (r === 'initial') initial = true;
    }
    if (!ok) continue;
    const tier = i === 0 ? SCORE.prefix : wordStart[i] ? SCORE.word : SCORE.contains;
    const score = tier - (initial ? SCORE.initialPenalty : 0);
    if (best === null || score > best.score) best = { score, range: [i, i + m] };
    if (score === SCORE.prefix) break;
  }
  return best;
}

/** 겹치거나 맞닿은 범위를 합치고 앞에서부터 정렬한다. */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** 질의를 단어(글자 배열) 목록으로. 빈 질의는 빈 목록이다. */
const termsOf = (query: string): string[][] =>
  query
    .split(/\s+/)
    .filter((t) => t !== '')
    .map(foldChars);

function matchPrepared(terms: string[][], text: PreparedText): TitleMatch | null {
  if (terms.length === 0 || text.chars.length === 0) return null;
  let score = 0;
  const ranges: Range[] = [];
  for (const term of terms) {
    const m = matchTerm(term, text);
    if (m === null) return null;
    score += m.score;
    ranges.push(m.range);
  }
  return { score, ranges: mergeRanges(ranges) };
}

/** 질의(공백으로 나눈 단어 전부)가 본문에 맞으면 점수와 하이라이트 범위, 아니면 null. */
export function matchTitle(query: string, text: string): TitleMatch | null {
  return matchPrepared(termsOf(query), prepareText(text));
}

export type TitleItem = { path: string; title: string };
export type TitleHit = TitleItem & { score: number; titleRanges: Range[]; pathRanges: Range[] };
export type PreparedTitle = { item: TitleItem; title: PreparedText; path: PreparedText };

export const prepareTitle = (item: TitleItem): PreparedTitle => ({ item, title: prepareText(item.title), path: prepareText(item.path) });

/** 제목 일치가 경로 일치보다 앞이다(같은 점수면 +1). */
function scorePrepared(terms: string[][], p: PreparedTitle): TitleHit | null {
  const t = matchPrepared(terms, p.title);
  if (t !== null) return { ...p.item, score: t.score + 1, titleRanges: t.ranges, pathRanges: [] };
  const m = matchPrepared(terms, p.path);
  if (m !== null) return { ...p.item, score: m.score, titleRanges: [], pathRanges: m.ranges };
  return null;
}

/** 점수 내림차순 → 제목 짧은 순 → 경로순. */
const byRank = (a: TitleHit, b: TitleHit): number => b.score - a.score || a.title.length - b.title.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** 미리 푼 목록 전체를 훑어 상위 limit 건. 2,300 건에 수 ms 다(tests/ui/title-match.test.ts 가 잰다). */
export function rankPrepared(query: string, prepared: readonly PreparedTitle[], limit: number): TitleHit[] {
  const terms = termsOf(query);
  if (terms.length === 0) return [];
  const hits: TitleHit[] = [];
  for (const p of prepared) {
    const h = scorePrepared(terms, p);
    if (h !== null) hits.push(h);
  }
  return hits.sort(byRank).slice(0, limit);
}

/** 준비 없이 한 번에. 시험·작은 목록용이다. 화면은 목록을 한 번 준비해 두고 rankPrepared 를 쓴다. */
export function rankTitles(query: string, items: readonly TitleItem[], limit: number): TitleHit[] {
  return rankPrepared(query, items.map(prepareTitle), limit);
}
