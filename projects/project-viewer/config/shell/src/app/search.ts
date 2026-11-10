// 검색의 순수 부분. 페이지 항목·용어·원본 본문을 한 색인에 모아 한꺼번에 찾는다.
// 모든 결과는 열 수 있는 경로를 가져야 한다 — 찾았는데 갈 곳이 없으면 쓸모가 없다.

import type { Block, Bundle, Field, SourceDoc } from '../../model/types.ts';
import type { Route } from './router.ts';
import { inlineToPlain } from './parseInline.ts';

export type SearchKind =
  | 'page'
  | 'block'
  | 'node'
  | 'tree-node'
  | 'step'
  | 'stage'
  | 'stage-item'
  | 'item'
  | 'row'
  | 'glossary'
  | 'doc';

export interface SearchEntry {
  id: string;
  kind: SearchKind;
  title: string;
  text: string;
  where: string; // 결과 목록에 보일 위치 설명
  route: Route;
}
export interface SearchHit {
  entry: SearchEntry;
  score: number;
  snippet: string;
}

const KIND_LABEL: Record<SearchKind, string> = {
  page: '페이지',
  block: '블록',
  node: '노드',
  'tree-node': '구성 요소',
  step: '스텝',
  stage: '단계',
  'stage-item': '단계 항목',
  item: '항목',
  row: '행',
  glossary: '용어',
  doc: '원본',
};

export function kindLabel(kind: SearchKind): string {
  return KIND_LABEL[kind];
}

function joinText(parts: (string | undefined)[], fields?: Field[]): string {
  const all = parts.filter((p): p is string => typeof p === 'string' && p !== '');
  for (const field of fields ?? []) all.push(`${field.label}: ${field.text}`);
  return all.map(inlineToPlain).join(' · ');
}

function blockEntries(block: Block, pageId: string, pageTitle: string, push: (e: SearchEntry) => void): void {
  const at = (itemId: string): Route => ({ kind: 'page', pageId, itemId });

  if (block.id !== undefined || block.title !== undefined || block.intro !== undefined) {
    const id = block.id ?? `${pageId}::${block.type}`;
    push({
      id,
      kind: 'block',
      title: block.title ?? pageTitle,
      text: joinText([block.intro]),
      where: pageTitle,
      route: block.id === undefined ? { kind: 'page', pageId } : at(block.id),
    });
  }

  switch (block.type) {
    case 'graph':
      for (const node of block.nodes) {
        push({
          id: node.id,
          kind: 'node',
          title: node.label,
          text: joinText([node.easy, node.tech, node.tag], node.fields),
          where: pageTitle,
          route: at(node.id),
        });
      }
      break;
    case 'tree':
      for (const node of block.nodes) {
        push({
          id: node.id,
          kind: 'tree-node',
          title: node.label,
          text: joinText([node.easy, node.tech, node.tag], node.fields),
          where: pageTitle,
          route: at(node.id),
        });
      }
      break;
    case 'sequence':
      for (const step of block.steps) {
        push({
          id: step.id,
          kind: 'step',
          title: step.label,
          text: joinText([step.easy, step.why, step.tech, step.lane], step.fields),
          where: pageTitle,
          route: at(step.id),
        });
      }
      break;
    case 'stages':
      for (const stage of block.stages) {
        push({
          id: stage.id,
          kind: 'stage',
          title: stage.title,
          text: joinText([stage.short, stage.question, stage.owner, stage.output, stage.stop], stage.fields),
          where: pageTitle,
          route: at(stage.id),
        });
        for (const item of stage.items ?? []) {
          push({
            id: item.id,
            kind: 'stage-item',
            title: item.label,
            text: joinText([item.criteria], item.fields),
            where: `${pageTitle} › ${stage.title}`,
            route: at(item.id),
          });
        }
      }
      break;
    case 'items':
      for (const item of block.items) {
        push({
          id: item.id,
          kind: 'item',
          title: item.label,
          text: joinText([item.body, ...(item.tags ?? [])], item.fields),
          where: pageTitle,
          route: at(item.id),
        });
      }
      break;
    case 'table':
      for (const row of block.rows) {
        const cells = block.columns.map((col) => {
          const cell = row.cells[col.id];
          return typeof cell === 'string' ? cell : cell?.text;
        });
        const first = cells.find((c) => typeof c === 'string' && c !== '');
        push({
          id: row.id,
          kind: 'row',
          title: first ?? row.id,
          text: joinText(cells),
          where: block.title ? `${pageTitle} › ${block.title}` : pageTitle,
          route: at(row.id),
        });
      }
      break;
    case 'mermaid':
    case 'prose':
      break;
  }
}

// 원본은 절 단위로 나눠 색인한다. 찾은 자리로 바로 스크롤하기 위해서다.
function docEntries(doc: SourceDoc, push: (e: SearchEntry) => void): void {
  if (doc.body === '') {
    push({
      id: doc.id,
      kind: 'doc',
      title: doc.title,
      text: '',
      where: doc.group ?? '원본',
      route: { kind: 'docs', sourceId: doc.id },
    });
    return;
  }
  const lines = doc.body.split('\n');
  const marks = [...doc.headings].sort((a, b) => a.line - b.line);
  const lead = lines.slice(0, (marks[0]?.line ?? lines.length + 1) - 1).join('\n');
  if (lead.trim() !== '') {
    push({
      id: doc.id,
      kind: 'doc',
      title: doc.title,
      text: lead,
      where: doc.group ?? '원본',
      route: { kind: 'docs', sourceId: doc.id },
    });
  }
  marks.forEach((heading, i) => {
    const end = (marks[i + 1]?.line ?? lines.length + 1) - 1;
    push({
      id: `${doc.id}#${heading.slug}`,
      kind: 'doc',
      title: heading.text,
      text: lines.slice(heading.line - 1, end).join('\n'),
      where: doc.title,
      route: { kind: 'docs', sourceId: doc.id, slug: heading.slug },
    });
  });
}

export function buildSearchIndex(bundle: Bundle): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const push = (e: SearchEntry) => entries.push(e);

  for (const page of bundle.viewer.pages) {
    push({
      id: page.id,
      kind: 'page',
      title: page.title,
      text: '',
      where: '페이지',
      route: { kind: 'page', pageId: page.id },
    });
    for (const block of page.blocks) blockEntries(block, page.id, page.title, push);
  }

  for (const term of bundle.viewer.glossary ?? []) {
    push({
      id: term.id,
      kind: 'glossary',
      title: term.term,
      text: joinText([term.easy, term.tech], term.fields),
      where: '용어',
      route: { kind: 'glossary', termId: term.id },
    });
  }

  for (const doc of Object.values(bundle.docs)) docEntries(doc, push);

  return entries;
}

function snippetOf(text: string, needle: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = flat.toLowerCase().indexOf(needle);
  if (at < 0) return flat.slice(0, 120);
  const start = Math.max(0, at - 40);
  const end = Math.min(flat.length, at + needle.length + 60);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

export function search(index: SearchEntry[], q: string, limit = 60): SearchHit[] {
  const needle = q.trim().toLowerCase();
  if (needle === '') return [];

  const hits: SearchHit[] = [];
  index.forEach((entry, order) => {
    const title = entry.title.toLowerCase();
    const body = entry.text.toLowerCase();
    const inTitle = title.includes(needle);
    const inBody = body.includes(needle);
    if (!inTitle && !inBody) return;
    // 제목이 맞은 결과를 위로 올린다. 같은 점수면 색인 순서(= 화면 순서)를 지킨다.
    const score = (inTitle ? 2 : 0) + (inBody ? 1 : 0) + (title === needle ? 2 : 0);
    hits.push({ entry, score: score * 1000 - order, snippet: snippetOf(inBody ? entry.text : entry.title, needle) });
  });

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
