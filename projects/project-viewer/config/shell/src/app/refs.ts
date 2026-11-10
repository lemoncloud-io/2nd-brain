// 서술 문자열 안의 참조 토큰을 링크로 푸는 순수 모듈. 화면 코드는 여기서 받은 조각(RefPiece)만 그린다.
// 두 가지를 푼다 — (1) 항목 id(`D56`·`T12-6`·`B0-a`·`Q7′`): 뷰어 안에 그 id 의 항목이 실제로 있을 때만 그 항목으로,
// (2) 절 참조(`§ 7.9.2`·`SPEC § 7.9.7`·`PLAN T13`): sources[] 의 원본 문서에 그 번호·토큰으로 시작하는 헤딩이 있을 때만 그 절로.
// 없는 id·없는 절·모르는 문서 이름은 글자 그대로 둔다. viewer.yml 스키마는 건드리지 않는다 — 렌더만 바뀐다.

import type { Bundle, Heading, SourceDoc } from '../../model/types.ts';
import type { EntityRecord } from './entities.ts';
import { KIND_LABEL } from './entities.ts';
import { inlineToPlain, parseInline } from './parseInline.ts';
import { formatRoute } from './router.ts';
import type { Route } from './router.ts';

/** 링크 하나가 가리키는 곳과 호버 미리보기에 보일 것. */
export interface RefTarget {
  kind: 'item' | 'section';
  href: string;
  title: string; // 항목 제목 또는 절 헤딩
  meta?: string; // 항목: 종류·상태·페이지 / 절: 원본 문서 제목
  summary?: string; // 항목: 첫 해설 한 줄 / 절: 첫 문단
}
export type RefPiece = { type: 'text'; text: string } | { type: 'ref'; text: string; target: RefTarget };

/** 토큰 → 대상. 없으면 null. 화면(App)이 Bundle 로 한 번 만든다. */
export interface RefResolver {
  item(id: string): RefTarget | null;
  section(docName: string | undefined, key: string): RefTarget | null;
}

/** 미리보기 한 줄의 최대 길이. */
const SUMMARY_MAX = 160;

// 항목 id 토큰: 대문자 1~3 + 숫자 1~3, 뒤에 `-a`·`.c1`·`-6` 같은 조각, 끝에 프라임(열린 결정 `Q7′`).
// 소문자 머리(`v5.0.3`)·글자 안(`SHA256` 은 한 토큰으로 잡히되 항목이 없어 글자로 남는다)은 링크가 되지 않는다.
const TOKEN = "[A-Z]{1,3}\\d{1,3}(?:[-.][A-Za-z0-9]{1,4})*[′'’]?";
// 원본 문서 이름(`SPEC`·`PLAN`·`high-levels`). sources 의 id 또는 파일 이름과 맞을 때만 문서로 본다.
const NAME = '[A-Za-z][A-Za-z0-9-]*';
// 세 꼴을 한 정규식으로 — 앞 대안이 우선한다: ① `[이름 ]§ n.n`, ② `이름 토큰`, ③ 토큰.
const REF_RE = new RegExp(
  `(?<![A-Za-z0-9_./#])(?:(${NAME})\\s+)?§\\s*(\\d+(?:\\.\\d+)*)(?!\\d|\\.\\d)` +
    `|(?<![A-Za-z0-9_./#])(${NAME})\\s+(${TOKEN})(?![A-Za-z0-9_])` +
    `|(?<![A-Za-z0-9_./#])(${TOKEN})(?![A-Za-z0-9_])`,
  'gu',
);

/** 정규식 글자 이스케이프. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 긴 글은 한 줄로 자른다. */
function clip(text: string, max = SUMMARY_MAX): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

/** md 한 줄에서 인라인 표기를 떼어 평문으로 — 미리보기용이라 정확한 파서는 쓰지 않는다. */
export function stripMarkdown(line: string): string {
  return line
    .replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/, '') // 목록 머리
    .replace(/^\s{0,3}>\s?/, '') // 인용 머리
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // [[slug|별칭]]
    .replace(/\[\[([^\]]+)\]\]/g, '$1') // [[slug]]
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // [글](주소)
    .replace(/<[^>]+>/g, '') // html 태그
    .replace(/\*\*([^*]+)\*\*/g, '$1') // 굵게
    .replace(/~~([^~]+)~~/g, '$1') // 취소선
    .replace(/`([^`]*)`/g, '$1') // 코드
    .replace(/^\|?\s*|\s*\|?$/g, '') // 표 줄의 양끝 파이프
    .replace(/\s*\|\s*/g, ' · ') // 표 칸 구분
    .trim();
}

/** 본문에서 헤딩 줄의 번호(0부터)를 차례로 — 코드펜스 안의 `#` 은 헤딩이 아니다. */
function headingLines(body: string): number[] {
  const out: number[] = [];
  let fence: string | null = null;
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (open !== null) {
      if (fence === null) fence = open[1]!;
      else if (line.trim().startsWith(fence[0]!.repeat(3))) fence = null;
      continue;
    }
    if (fence === null && /^#{1,6}\s/.test(line)) out.push(i);
  }
  return out;
}

/** 절의 첫 문단(헤딩 다음, 빈 줄로 끝나는 첫 글 덩어리)을 한 줄로. 없으면 undefined. */
export function sectionSummary(doc: SourceDoc, heading: Heading): string | undefined {
  if (doc.body === '') return undefined;
  const lines = doc.body.split('\n');
  const starts = headingLines(doc.body);
  const index = doc.headings.indexOf(heading);
  // 본문의 헤딩 수와 색인의 헤딩 수가 같을 때만 순서로 찾고, 아니면 헤딩 글로 찾는다.
  let at = starts.length === doc.headings.length ? starts[index] : undefined;
  if (at === undefined) {
    at = starts.find((n) => stripMarkdown(lines[n]!.replace(/^#{1,6}\s+/, '')) === heading.text);
  }
  if (at === undefined) return undefined;
  const picked: string[] = [];
  let fence: string | null = null;
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    // 코드펜스 안은 문단이 아니다 — 여는 줄부터 닫는 줄까지 건너뛴다.
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (open !== null) {
      fence = fence === null ? open[1]! : null;
      continue;
    }
    if (fence !== null) continue;
    if (/^#{1,6}\s/.test(line)) break; // 다음 절
    if (line.trim() === '') {
      if (picked.length > 0) break;
      continue;
    }
    if (/^\s*\|/.test(line) || /^\s*:?-{3,}\s*$/.test(line)) continue; // 표 줄·수평선은 문단이 아니다
    const plain = stripMarkdown(line);
    if (plain !== '') picked.push(plain);
  }
  return picked.length === 0 ? undefined : clip(picked.join(' '));
}

/** 헤딩 글이 key(절 번호 `7.9.2` 또는 토큰 `T13`)로 시작하는가. `7.9` 는 `7.9.2 …` 에 맞지 않는다. */
function headingFor(doc: SourceDoc, key: string): Heading | undefined {
  const re = new RegExp(`^(?:§\\s*)?${escapeRe(key)}(?![0-9A-Za-z]|\\.[0-9])`);
  return doc.headings.find((h) => re.test(h.text));
}

/** 경로의 파일 이름(확장자 없이). */
function basename(path: string): string {
  const last = path.split('/').pop() ?? path;
  return last.replace(/\.[^.]+$/, '');
}

/** 볼트 안 md 원본만 절 링크의 대상이다(코드·데이터·저장소 밖은 절이 없다). */
function sectionDocs(bundle: Bundle): SourceDoc[] {
  return bundle.viewer.sources
    .filter((s) => s.kind === 'doc' && s.repo === undefined)
    .map((s) => bundle.docs[s.id])
    .filter((d): d is SourceDoc => d !== undefined && !d.missing);
}

/** 문서 이름 → 원본. id 가 먼저, 다음은 파일 이름(대소문자 무시). */
function docByName(docs: SourceDoc[], name: string): SourceDoc | undefined {
  const want = name.toLowerCase();
  return docs.find((d) => d.id.toLowerCase() === want) ?? docs.find((d) => basename(d.path).toLowerCase() === want);
}

/** 항목 미리보기의 두 번째 줄: 종류 · 상태 · 페이지. */
function itemMeta(bundle: Bundle, entity: EntityRecord): string {
  const parts = [KIND_LABEL[entity.kind]];
  const view = bundle.status[entity.id];
  if (view !== undefined && view.origin !== 'none') parts.push(view.label);
  if (entity.pageTitle !== undefined) parts.push(entity.pageTitle);
  return parts.join(' · ');
}

/** 항목으로 가는 라우트. 용어는 용어 페이지, 나머지는 그 항목이 있는 페이지. */
function itemRoute(entity: EntityRecord): Route | null {
  if (entity.kind === 'glossary') return { kind: 'glossary', termId: entity.id };
  if (entity.pageId === undefined) return null;
  return { kind: 'page', pageId: entity.pageId, itemId: entity.id };
}

/** Bundle 하나로 해석기를 만든다. 항목 색인(entities)은 App 이 이미 만든 것을 받는다. */
export function buildRefResolver(bundle: Bundle, entities: Map<string, EntityRecord>): RefResolver {
  const docs = sectionDocs(bundle);
  // 이름 없는 `§ n` 의 기본 원본: id 또는 파일 이름이 spec 인 문서.
  const spec = docByName(docs, 'spec');

  // id 로 항목을 찾는다 — 정확히 같은 id, 없으면 `.id` 로 끝나는 유일한 항목(`T12-6` → `B8.T12-6`).
  const findEntity = (id: string): EntityRecord | undefined => {
    const exact = entities.get(id);
    if (exact !== undefined) return exact;
    const tail = `.${id}`;
    const ends = [...entities.values()].filter((e) => e.id.endsWith(tail));
    return ends.length === 1 ? ends[0] : undefined;
  };

  // 항목 id → 링크 대상(그 항목 상세 주소·제목·상태·첫 해설). 없으면 null.
  const item = (id: string): RefTarget | null => {
    const entity = findEntity(id);
    if (entity === undefined) return null;
    const route = itemRoute(entity);
    if (route === null) return null;
    const first = entity.fields[0];
    return {
      kind: 'item',
      href: formatRoute(route),
      title: inlineToPlain(entity.title),
      meta: itemMeta(bundle, entity),
      ...(first === undefined ? {} : { summary: clip(inlineToPlain(first.text)) }),
    };
  };

  // 절 참조 → 링크 대상(원본 절 주소·헤딩·첫 문단). 문서 이름이 없으면 SPEC, 다음은 유일한 원본.
  const section = (docName: string | undefined, key: string): RefTarget | null => {
    let doc: SourceDoc | undefined;
    let heading: Heading | undefined;
    if (docName !== undefined) {
      doc = docByName(docs, docName);
      if (doc === undefined) return null; // 모르는 문서 이름은 넘겨짚지 않는다
      heading = headingFor(doc, key);
    } else {
      // SPEC 이 먼저, 없으면 그 번호의 절이 정확히 하나뿐인 원본.
      heading = spec === undefined ? undefined : headingFor(spec, key);
      doc = heading === undefined ? undefined : spec;
      if (heading === undefined) {
        const hits = docs.flatMap((d) => {
          const h = headingFor(d, key);
          return h === undefined ? [] : [{ d, h }];
        });
        if (hits.length === 1) ({ d: doc, h: heading } = hits[0]!);
      }
    }
    if (doc === undefined || heading === undefined) return null;
    const summary = sectionSummary(doc, heading);
    return {
      kind: 'section',
      href: formatRoute({ kind: 'docs', sourceId: doc.id, slug: heading.slug }),
      title: heading.text,
      meta: doc.title,
      ...(summary === undefined ? {} : { summary }),
    };
  };

  return { item, section };
}

/** 토큰 하나를 항목으로 푼다 — 그대로, 프라임 없이, 꼬리 조각을 하나씩 떼며(`D5.1` → `D5`). 맞은 글자 길이를 함께 준다. */
function resolveToken(token: string, resolver: RefResolver): { text: string; target: RefTarget } | null {
  let cand = token;
  for (;;) {
    const target = resolver.item(cand);
    if (target !== null) return { text: cand, target };
    const shorter = cand.replace(/[′'’]$/, '');
    if (shorter !== cand) {
      cand = shorter;
      continue;
    }
    const cut = cand.replace(/[-.][A-Za-z0-9]{1,4}$/, '');
    if (cut === cand) return null;
    cand = cut;
  }
}

/** 서술 평문 한 조각을 글자·링크 조각으로 나눈다. 링크가 하나도 없으면 글자 조각 하나다. */
export function linkRefs(text: string, resolver: RefResolver): RefPiece[] {
  const out: RefPiece[] = [];
  let plain = '';
  // 모아 둔 글자를 글자 조각 하나로 내보낸다.
  const flush = () => {
    if (plain !== '') out.push({ type: 'text', text: plain });
    plain = '';
  };
  // 조각 목록을 붙인다 — 글자는 모아 두고, 링크 앞에서만 글자를 내보낸다.
  const push = (pieces: RefPiece[]) => {
    for (const p of pieces) {
      if (p.type === 'text') plain += p.text;
      else {
        flush();
        out.push(p);
      }
    }
  };
  // 토큰 하나를 링크로 바꾼다. 꼬리가 남으면(`M4-B9` → `M4` + `-B9`) 그 꼬리를 다시 훑는다 — 꼬리 안의 토큰도 항목일 수 있다.
  const token = (tok: string): RefPiece[] => {
    const hit = resolveToken(tok, resolver);
    if (hit === null) return [{ type: 'text', text: tok }];
    const rest = tok.slice(hit.text.length);
    const head: RefPiece = { type: 'ref', text: hit.text, target: hit.target };
    return rest === '' ? [head] : [head, ...linkRefs(rest, resolver)];
  };

  let last = 0;
  // matchAll 은 정규식을 복제해 돈다 — 재귀 호출이 전역 정규식의 lastIndex 를 건드리지 않는다.
  for (const m of text.matchAll(REF_RE)) {
    plain += text.slice(last, m.index);
    last = m.index + m[0].length;
    const whole = m[0];
    const [, secDoc, secKey, refDoc, refTok, bareTok] = m;
    if (secKey !== undefined) {
      // ① `[이름 ]§ n.n` — 이름이 있는데 원본이 아니면 통째로 글자다(다른 문서의 절을 SPEC 으로 넘겨짚지 않는다).
      const target = resolver.section(secDoc, secKey);
      if (target !== null) push([{ type: 'ref', text: whole, target }]);
      else if (secDoc === undefined) plain += whole;
      else push([...linkRefs(secDoc, resolver), { type: 'text', text: whole.slice(secDoc.length) }]);
    } else if (refTok !== undefined && refDoc !== undefined) {
      // ② `이름 토큰` — 그 원본에 토큰으로 시작하는 헤딩이 있으면 절, 아니면 이름은 글자(또는 그 자체가 항목)·토큰은 항목.
      const target = resolver.section(refDoc, refTok);
      if (target !== null) push([{ type: 'ref', text: whole, target }]);
      else push([...linkRefs(refDoc, resolver), { type: 'text', text: whole.slice(refDoc.length, whole.length - refTok.length) }, ...token(refTok)]);
    } else if (bareTok !== undefined) {
      // ③ 토큰 하나.
      push(token(bareTok));
    } else {
      plain += whole;
    }
  }
  plain += text.slice(last);
  flush();
  return out;
}

/** Inline 이 그리는 조각: 코드 스팬은 그대로, 굵게는 안쪽을 다시 풀고, 평문은 링크 조각이 된다. 해석기가 없으면 링크 없이 글자다. */
export type InlinePiece = { type: 'code'; text: string } | { type: 'strong'; pieces: RefPiece[] } | RefPiece;
/** 서술 문자열 하나를 Inline 이 그릴 조각 목록으로 나눈다. */
export function inlinePieces(text: string, resolver: RefResolver | null): InlinePiece[] {
  // 평문 한 조각: 해석기가 있으면 링크로 풀고, 없으면 글자 그대로.
  const plain = (t: string): RefPiece[] => (resolver === null ? [{ type: 'text', text: t }] : linkRefs(t, resolver));
  return parseInline(text).flatMap((token): InlinePiece[] => {
    if (token.type === 'code') return [token];
    if (token.type === 'strong') return [{ type: 'strong', pieces: plain(token.text) }];
    return plain(token.text);
  });
}

/** 미리보기 카드의 자리(뷰포트 기준). 아래가 모자라면 위로, 오른쪽 끝에서는 안으로 민다. */
export type CardPos = { left: number; top?: number; bottom?: number };
// 미리보기 카드 너비(px) — base.css 의 .ref__card 와 같다.
const CARD_W = 320;
// 위로 띄울지 판단할 때 쓰는 카드 높이 어림값(px).
const CARD_H = 150;
/** 링크 사각형과 창 크기로 카드 자리를 고른다 — 아래 우선, 모자라면 위, 좌우는 창 안으로. */
export function cardPosition(rect: { left: number; top: number; bottom: number }, vw: number, vh: number): CardPos {
  const left = Math.max(8, Math.min(rect.left, vw - CARD_W - 8));
  if (rect.bottom + CARD_H > vh && rect.top > CARD_H) return { left, bottom: vh - rect.top + 6 };
  return { left, top: rect.bottom + 6 };
}
