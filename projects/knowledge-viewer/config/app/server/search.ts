// 검색. 인덱스가 가진 제목·alias·경로·본문을 훑는다. 형태소 분석 없이 소문자 변환 + includes다(한글도 같다).
import fs from 'node:fs';
import path from 'node:path';

import { splitFrontmatter, titleOf } from '../shared/frontmatter.ts';
import { isCanonicallyAllowed, walkDisk } from '../shared/scope.ts';
import type { VaultIndex } from './index-store.ts';

export type SearchHit = { path: string; title: string; score: number; snippet: string };
export type SearchOptions = { includeOutside: boolean; root: string; includePrivate?: boolean };

const SCORE_TITLE = 100;
const SCORE_ALIAS = 80;
const SCORE_PATH = 40;
const SCORE_BODY_MAX = 20;
const SNIPPET_LEN = 120;
const OUTSIDE_TOP: readonly string[] = ['raw', 'archive'];

type Doc = { path: string; title: string; aliases: string[]; body: string };

/** 본문에서 term이 나오는 횟수(겹치지 않게 센다). */
function countOf(hay: string, term: string): number {
  let n = 0;
  for (let i = hay.indexOf(term); i !== -1; i = hay.indexOf(term, i + term.length)) n += 1;
  return n;
}

/** 첫 본문 일치 둘레 약 120자. 줄바꿈은 공백으로 접는다. */
function snippetAt(body: string, lower: string, term: string): string {
  const at = lower.indexOf(term);
  const start = Math.max(0, at - Math.floor((SNIPPET_LEN - term.length) / 2));
  const raw = body.slice(start, start + SNIPPET_LEN).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${raw}${start + SNIPPET_LEN < body.length ? '…' : ''}`;
}

/** 모든 단어가 제목·alias·경로·본문 어딘가에 있어야 한다(AND). 아니면 null이다. */
function scoreDoc(doc: Doc, terms: string[]): SearchHit | null {
  const title = doc.title.toLowerCase();
  const aliases = doc.aliases.map((a) => a.toLowerCase());
  const p = doc.path.toLowerCase();
  const body = doc.body.toLowerCase();
  let score = 0;
  let bodyCount = 0;
  let bodyTerm: string | null = null;
  for (const t of terms) {
    const inTitle = title.includes(t);
    const inAlias = aliases.some((a) => a.includes(t));
    const inPath = p.includes(t);
    const n = countOf(body, t);
    if (!inTitle && !inAlias && !inPath && n === 0) return null;
    if (inTitle) score += SCORE_TITLE;
    if (inAlias) score += SCORE_ALIAS;
    if (inPath) score += SCORE_PATH;
    bodyCount += n;
    if (n > 0 && bodyTerm === null) bodyTerm = t;
  }
  score += Math.min(bodyCount, SCORE_BODY_MAX);
  const snippet = bodyTerm !== null ? snippetAt(doc.body, body, bodyTerm) : doc.title;
  return { path: doc.path, title: doc.title, score, snippet };
}

function outsideDocs(opts: SearchOptions): Doc[] {
  const out: Doc[] = [];
  const paths = walkDisk(opts.root, { includePrivate: opts.includePrivate ?? false }).filter(
    (p) => p.endsWith('.md') && OUTSIDE_TOP.includes(p.split('/')[0] ?? ''),
  );
  for (const p of paths) {
    const abs = path.join(opts.root, p);
    try {
      // 심링크는 따라가지 않는다. 정식 경로가 볼트 안·허용 범위 밖이면 읽지 않는다.
      if (fs.lstatSync(abs).isSymbolicLink()) continue;
      if (!isCanonicallyAllowed(opts.root, abs, { includePrivate: opts.includePrivate ?? false })) continue;
      const { data, body } = splitFrontmatter(fs.readFileSync(abs, 'utf8'));
      out.push({ path: p, title: titleOf(p, data, body), aliases: [], body });
    } catch {
      // 읽지 못한 파일은 건너뛴다.
    }
  }
  return out;
}

/**
 * 점수 내림차순, 같으면 경로순이다. 자르기(상위 50)는 호출한 쪽이 한다.
 * raw·archive는 includeOutside일 때만, 디스크에서 그때 읽는다(alias는 없다).
 */
export function searchIndex(index: VaultIndex, q: string, opts: SearchOptions): SearchHit[] {
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t !== '');
  if (terms.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const p of index.files) {
    const hit = scoreDoc({ path: p, title: index.title(p), aliases: index.aliases(p), body: index.body(p) }, terms);
    if (hit) hits.push(hit);
  }
  if (opts.includeOutside) {
    for (const doc of outsideDocs(opts)) {
      const hit = scoreDoc(doc, terms);
      if (hit) hits.push(hit);
    }
  }
  return hits.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
