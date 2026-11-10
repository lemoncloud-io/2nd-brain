// 원문 충실도 검사 — "해설은 원본 문장에서만"을 기계로 본다.
// 파일을 읽지 않는 순수 함수다. 원본 본문은 docs 맵으로 주입받는다.
// 규칙의 정본은 ../../docs/schema.md § 충실도 검사 (선택 모드).
import type { Cell, EvidenceRef, Field, GraphNode, Issue, TreeNode, ViewerDoc } from './types.ts';

/** 해설 문자열 하나와 그 해설에 걸린 근거의 원본 id들. */
export interface Explanation {
  where: string;
  text: string;
  sources: string[];
}

export interface FidelityInput {
  viewer: ViewerDoc;
  /** 원본 id → 원문 전체. 읽지 못한 원본·kind: data·저장소 코드는 넣지 않는다. */
  docs: Map<string, string>;
}

export interface FidelityResult {
  strings: number;
  sentences: number;
  exact: number;
  trimmed: number;
  elsewhere: number;
  missing: number;
  skipped: number;
  issues: Issue[];
}

const WINDOW = 10; // 창 크기(문자)
const MIN_LENGTH = 8; // 정규화 길이가 이보다 짧은 문장은 세지 않는다
const TRIMMED_PERCENT = 85; // 이 비율 이상이면 "다듬음"
const CONTEXT_PAD = 2; // 숫자 덩이 앞뒤로 넓히는 글자 수
const GAP_MAX = 20; // 경고에 적는 "다른 곳" 조각의 최대 길이

const BR = /<br\s*\/?>/gi;
const WIKI_ALIAS = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;
const WIKI = /\[\[([^\]]+)\]\]/g;
const LINK = /\[([^\]]+)\]\([^)]+\)/g;
const LIST_MARKER = /^\s*(?:[-*+]|\d{1,2}\.)\s+/gm;
const INLINE = /[`*_>|#[\]]/g;
const SPACES = /\s+/g;
const SENTENCE = /(?<=[.!?다])\s+|\n+/;
const NUMBER_CHUNK = /[0-9]+(?:[.,:\-/~][0-9]+)*/g;

/**
 * 비교용 정규화. 순서가 규칙이다 — `<br/>`를 먼저 떼야 mermaid의 줄바꿈이 이어 붙은 문장과 같아지고,
 * 목록 표지를 인라인 표기보다 먼저 떼야 줄 머리의 날짜(`2026-09-17 …`)가 살아남는다.
 */
export function normalizeForFidelity(text: string): string {
  return text
    .replace(BR, '')
    .replace(WIKI_ALIAS, '$2')
    .replace(WIKI, '$1')
    .replace(LINK, '$1')
    .replace(LIST_MARKER, '')
    .replace(INLINE, '')
    .replace(SPACES, '');
}

/** `.`·`!`·`?`·`다` 뒤의 공백이나 줄바꿈에서 나눈다. */
export function splitSentences(text: string): string[] {
  return text.split(SENTENCE);
}

/** 근거 물려받기 — 앞에서부터 비어 있지 않은 첫 목록의 원본 id들. */
function inherit(...lists: (EvidenceRef[] | undefined)[]): string[] {
  for (const list of lists) {
    if (list && list.length > 0) return list.map((e) => e.source);
  }
  return [];
}

const cellText = (cell: Cell): string => (typeof cell === 'string' ? cell : cell.text);
const cellEvidence = (cell: Cell): EvidenceRef[] | undefined => (typeof cell === 'string' ? undefined : cell.evidence);

/** 해설 필드만 모은다. 이름표(label·title·term·tag·lane·short·owner)와 mermaid의 code는 해설이 아니다. */
export function collectExplanations(viewer: ViewerDoc): Explanation[] {
  const found: Explanation[] = [];
  const push = (where: string, text: string | undefined, sources: string[]): void => {
    if (typeof text !== 'string' || text.trim() === '') return;
    found.push({ where, text, sources });
  };
  const pushFields = (where: string, fields: Field[] | undefined, sources: string[]): void => {
    fields?.forEach((f, i) => push(`${where}.fields[${i}].text`, f.text, sources));
  };

  viewer.pages.forEach((page, pi) => {
    page.blocks.forEach((block, bi) => {
      const bw = `pages[${pi}].blocks[${bi}]`;
      const blockEv = block.evidence;
      push(`${bw}.intro`, block.intro, inherit(blockEv));

      switch (block.type) {
        case 'graph':
        case 'tree': {
          const nodes: (GraphNode | TreeNode)[] = block.nodes;
          nodes.forEach((n, i) => {
            const w = `${bw}.nodes[${i}]`;
            const ev = inherit(n.evidence, blockEv);
            push(`${w}.easy`, n.easy, ev);
            push(`${w}.tech`, n.tech, ev);
            pushFields(w, n.fields, ev);
          });
          break;
        }
        case 'sequence': {
          pushFields(bw, block.fields, inherit(blockEv));
          block.steps.forEach((s, i) => {
            const w = `${bw}.steps[${i}]`;
            const ev = inherit(s.evidence, blockEv);
            push(`${w}.easy`, s.easy, ev);
            push(`${w}.why`, s.why, ev);
            push(`${w}.tech`, s.tech, ev);
            pushFields(w, s.fields, ev);
          });
          break;
        }
        case 'stages': {
          block.stages.forEach((s, i) => {
            const w = `${bw}.stages[${i}]`;
            const detail = s.detail ? [s.detail] : undefined; // 단계는 detail이 근거를 겸한다
            const ev = inherit(detail, blockEv);
            push(`${w}.question`, s.question, ev);
            push(`${w}.output`, s.output, ev);
            push(`${w}.stop`, s.stop, ev);
            pushFields(w, s.fields, ev);
            s.items?.forEach((it, j) => {
              const iw = `${w}.items[${j}]`;
              const iev = inherit(it.evidence, detail, blockEv);
              push(`${iw}.criteria`, it.criteria, iev);
              pushFields(iw, it.fields, iev);
            });
          });
          break;
        }
        case 'items': {
          block.items.forEach((it, i) => {
            const w = `${bw}.items[${i}]`;
            const ev = inherit(it.evidence, blockEv);
            push(`${w}.body`, it.body, ev);
            pushFields(w, it.fields, ev);
          });
          break;
        }
        case 'table': {
          block.rows.forEach((row, i) => {
            const w = `${bw}.rows[${i}]`;
            for (const [key, cell] of Object.entries(row.cells)) {
              push(`${w}.cells.${key}`, cellText(cell), inherit(cellEvidence(cell), row.evidence, blockEv));
            }
          });
          break;
        }
        case 'prose':
          push(`${bw}.text`, block.text, inherit(blockEv));
          break;
        case 'mermaid':
          break;
      }
    });
  });

  viewer.glossary?.forEach((term, i) => {
    const w = `glossary[${i}]`;
    const ev = inherit(term.evidence);
    push(`${w}.easy`, term.easy, ev);
    push(`${w}.tech`, term.tech, ev);
    pushFields(w, term.fields, ev);
  });

  return found;
}

/** 문자 단위로 미끄러지는 10자 창. 문장이 창보다 짧으면 문장 하나가 창 하나다. */
function windowsOf(n: string): string[] {
  const count = Math.max(1, n.length - WINDOW + 1);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) out.push(n.slice(i, i + WINDOW));
  return out;
}

function hits(wins: string[], corpus: string): number {
  let count = 0;
  for (const w of wins) if (corpus.includes(w)) count += 1;
  return count;
}

/** 숫자 덩이 하나와 앞뒤 2자씩 넓힌 문맥. */
export interface NumberContext {
  chunk: string;
  context: string;
}

/**
 * 정규화 문장의 숫자 덩이들. 창은 문장 가장자리 글자를 창 하나로만 덮기 때문에
 * 숫자 한 글자 변이가 85%를 넘어 통과한다 — 그래서 숫자는 문맥째로 따로 본다.
 */
export function numberContexts(n: string): NumberContext[] {
  const out: NumberContext[] = [];
  for (const m of n.matchAll(NUMBER_CHUNK)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    out.push({ chunk: m[0], context: n.slice(Math.max(0, start - CONTEXT_PAD), end + CONTEXT_PAD) });
  }
  return out;
}

interface Nearness {
  percent: number; // 창 일치율(정수 반올림)
  ratioOk: boolean; // 창 85% 이상
  badChunk: string | undefined; // 문맥이 말뭉치에 없는 첫 숫자 덩이
  near: boolean; // 창 85% 이상이고 숫자 문맥이 모두 있다
  gap: string | undefined; // 맞은 창 어느 것도 덮지 못한 첫 구간(최대 20자)
}

/** 문장 하나를 말뭉치 하나에 대고 재 본다. 백분율은 소수점 오차를 피해 정수 연산으로만 본다. */
function examine(n: string, wins: string[], chunks: NumberContext[], corpus: string): Nearness {
  const covered: boolean[] = new Array<boolean>(n.length).fill(false);
  let hit = 0;
  wins.forEach((w, i) => {
    if (!corpus.includes(w)) return;
    hit += 1;
    for (let k = i; k < n.length && k < i + WINDOW; k += 1) covered[k] = true;
  });
  const ratioOk = hit * 100 >= wins.length * TRIMMED_PERCENT;
  const badChunk = chunks.find((c) => !corpus.includes(c.context))?.chunk;

  let gap: string | undefined;
  const from = covered.indexOf(false);
  if (from !== -1) {
    let to = from;
    while (to < n.length && !covered[to]) to += 1;
    gap = n.slice(from, Math.min(to, from + GAP_MAX));
  }
  return { percent: Math.round((hit * 100) / wins.length), ratioOk, badChunk, near: ratioOk && badChunk === undefined, gap };
}

export function checkFidelity(input: FidelityInput): FidelityResult {
  const { viewer, docs } = input;

  // 본문을 읽은 원본만, 뷰어에 선언된 순서로 본다 — 어느 원본을 짚어 줄지가 정해지도록.
  const normalized = new Map<string, string>();
  const order: string[] = [];
  for (const spec of viewer.sources) {
    const body = docs.get(spec.id);
    if (body === undefined || normalized.has(spec.id)) continue;
    normalized.set(spec.id, normalizeForFidelity(body));
    order.push(spec.id);
  }
  // 정규화 본문에는 공백이 없으므로 줄바꿈으로 이으면 창이 원본 경계를 넘지 못한다.
  const everywhere = order.map((id) => normalized.get(id)!).join('\n');

  const cache = new Map<string, string>();
  const corpusOf = (ids: string[]): string => {
    const key = ids.join(' ');
    let corpus = cache.get(key);
    if (corpus === undefined) {
      corpus = ids.map((id) => normalized.get(id)!).join('\n');
      cache.set(key, corpus);
    }
    return corpus;
  };

  const issues: Issue[] = [];
  const counts = { strings: 0, sentences: 0, exact: 0, trimmed: 0, elsewhere: 0, missing: 0, skipped: 0 };

  const explanations = collectExplanations(viewer);
  counts.strings = explanations.length;

  for (const ex of explanations) {
    const cited = [...new Set(ex.sources)].filter((id) => normalized.has(id));
    const citedCorpus = cited.length > 0 ? corpusOf(cited) : '';

    for (const raw of splitSentences(ex.text)) {
      const n = normalizeForFidelity(raw);
      if (n.length < MIN_LENGTH) continue;
      counts.sentences += 1;

      // 근거로 건 원본의 본문을 하나도 읽지 못했으면 판정하지 않는다.
      if (cited.length === 0) {
        counts.skipped += 1;
        continue;
      }
      if (citedCorpus.includes(n)) {
        counts.exact += 1;
        continue;
      }
      const wins = windowsOf(n);
      const chunks = numberContexts(n);
      const snippet = raw.trim();
      const here = examine(n, wins, chunks, citedCorpus);
      if (here.near) {
        // 다듬음은 통과시키되 사람이 원문과 대조하도록 하나씩 보여 준다.
        counts.trimmed += 1;
        const spot = here.gap === undefined ? '' : `, 다른 곳 "${here.gap}"`;
        issues.push({
          level: 'warning',
          code: 'W_FIDELITY_TRIMMED',
          where: ex.where,
          message: `원본과 조금 다르다(일치 ${here.percent}%${spot}) — 눈으로 확인한다: ${snippet.slice(0, 60)}`,
        });
        continue;
      }
      const other = order.find((id) => {
        if (cited.includes(id)) return false;
        const corpus = normalized.get(id)!;
        return corpus.includes(n) || examine(n, wins, chunks, corpus).near;
      });
      if (other !== undefined) {
        counts.elsewhere += 1;
        issues.push({
          level: 'warning',
          code: 'W_FIDELITY_ELSEWHERE',
          where: ex.where,
          message: `근거로 건 원본이 아닌 곳(${other})에 있다: ${snippet.slice(0, 60)}`,
        });
        continue;
      }
      counts.missing += 1;
      const percent = Math.round((hits(wins, everywhere) * 100) / wins.length);
      // 창은 충분히 맞았는데 숫자 문맥에서 떨어졌으면 어느 덩이가 어긋났는지 짚어 준다.
      const message =
        here.ratioOk && here.badChunk !== undefined
          ? `숫자가 원본과 다르다("${here.badChunk}", 일치 ${percent}%): ${snippet.slice(0, 80)}`
          : `원본 어디에도 없는 문장이다(일치 ${percent}%): ${snippet.slice(0, 80)}`;
      issues.push({ level: 'error', code: 'E_FIDELITY', where: ex.where, message });
    }
  }

  return { ...counts, issues };
}
