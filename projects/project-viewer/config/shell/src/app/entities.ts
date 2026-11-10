// 화면 전체가 쓰는 id → 항목 색인. 근거 패널·상호참조·검색 결과가 모두 이 한 곳을 본다.
// 근거 물려받기(자기 evidence가 없으면 블록 evidence)를 여기서 한 번만 결정한다.

import type {
  Block,
  Bundle,
  EvidenceRef,
  Field,
  ResolvedTarget,
  SourceSpec,
} from '../../model/types.ts';

export type EntityKind =
  | 'block'
  | 'node'
  | 'tree-node'
  | 'step'
  | 'stage'
  | 'stage-item'
  | 'item'
  | 'row'
  | 'glossary';

export interface EntityRecord {
  id: string;
  kind: EntityKind;
  title: string;
  tag?: string;
  pageId?: string;
  pageTitle?: string;
  blockTitle?: string;
  fields: Field[]; // easy·tech·why·criteria·body를 이름표 붙여 정규화한 것
  evidence: EvidenceRef[];
  inherited: boolean; // 블록 근거를 물려받았는가
  hasStatus: boolean; // 단계·단계 항목이면 상태 출처를 따로 보여 준다
}

export const KIND_LABEL: Record<EntityKind, string> = {
  block: '블록',
  node: '노드',
  'tree-node': '구성 요소',
  step: '스텝',
  stage: '단계',
  'stage-item': '단계 항목',
  item: '항목',
  row: '행',
  glossary: '용어',
};

function narrative(pairs: [string, string | undefined][], extra?: Field[]): Field[] {
  const out: Field[] = [];
  for (const [label, text] of pairs) if (text) out.push({ label, text });
  for (const field of extra ?? []) out.push(field);
  return out;
}

interface Ctx {
  pageId: string;
  pageTitle: string;
  blockTitle?: string;
  blockEvidence: EvidenceRef[];
}

function add(
  map: Map<string, EntityRecord>,
  ctx: Ctx,
  base: Omit<EntityRecord, 'evidence' | 'inherited' | 'pageId' | 'pageTitle' | 'blockTitle'>,
  own: EvidenceRef[] | undefined,
): void {
  const has = own !== undefined && own.length > 0;
  map.set(base.id, {
    ...base,
    pageId: ctx.pageId,
    pageTitle: ctx.pageTitle,
    ...(ctx.blockTitle === undefined ? {} : { blockTitle: ctx.blockTitle }),
    evidence: has ? own : ctx.blockEvidence,
    inherited: !has && ctx.blockEvidence.length > 0,
  });
}

function indexBlock(map: Map<string, EntityRecord>, block: Block, pageId: string, pageTitle: string): void {
  const ctx: Ctx = {
    pageId,
    pageTitle,
    ...(block.title === undefined ? {} : { blockTitle: block.title }),
    blockEvidence: block.evidence ?? [],
  };

  if (block.id !== undefined) {
    add(
      map,
      ctx,
      {
        id: block.id,
        kind: 'block',
        title: block.title ?? block.id,
        fields: narrative([['설명', block.intro]]),
        hasStatus: false,
      },
      block.evidence,
    );
  }

  switch (block.type) {
    case 'graph':
      for (const n of block.nodes) {
        add(
          map,
          ctx,
          {
            id: n.id,
            kind: 'node',
            title: n.label,
            ...(n.tag === undefined ? {} : { tag: n.tag }),
            fields: narrative(
              [
                ['쉬운 말로', n.easy],
                ['기술적으로는', n.tech],
              ],
              n.fields,
            ),
            hasStatus: false,
          },
          n.evidence,
        );
      }
      break;
    case 'tree':
      for (const n of block.nodes) {
        add(
          map,
          ctx,
          {
            id: n.id,
            kind: 'tree-node',
            title: n.label,
            ...(n.tag === undefined ? {} : { tag: n.tag }),
            fields: narrative(
              [
                ['쉬운 말로', n.easy],
                ['기술적으로는', n.tech],
              ],
              n.fields,
            ),
            hasStatus: false,
          },
          n.evidence,
        );
      }
      break;
    case 'sequence':
      for (const s of block.steps) {
        add(
          map,
          ctx,
          {
            id: s.id,
            kind: 'step',
            title: s.label,
            ...(s.lane === undefined ? {} : { tag: s.lane }),
            fields: narrative(
              [
                ['쉬운 말로', s.easy],
                ['왜', s.why],
                ['기술적으로는', s.tech],
              ],
              s.fields,
            ),
            hasStatus: false,
          },
          s.evidence,
        );
      }
      break;
    case 'stages':
      for (const stage of block.stages) {
        // 단계는 detail이 근거를 겸한다(docs/schema.md § 근거 필수 규칙).
        add(
          map,
          ctx,
          {
            id: stage.id,
            kind: 'stage',
            title: stage.title,
            ...(stage.short === undefined ? {} : { tag: stage.short }),
            fields: narrative(
              [
                ['묻는 것', stage.question],
                ['담당', stage.owner],
                ['산출물', stage.output],
                ['중단 조건', stage.stop],
              ],
              stage.fields,
            ),
            hasStatus: true,
          },
          stage.detail === undefined ? undefined : [stage.detail],
        );
        for (const item of stage.items ?? []) {
          add(
            map,
            ctx,
            {
              id: item.id,
              kind: 'stage-item',
              title: item.label,
              fields: narrative([['통과 기준', item.criteria]], item.fields),
              hasStatus: true,
            },
            item.evidence,
          );
        }
      }
      break;
    case 'items':
      for (const item of block.items) {
        add(
          map,
          ctx,
          {
            id: item.id,
            kind: 'item',
            title: item.label,
            fields: narrative([['설명', item.body]], item.fields),
            hasStatus: false,
          },
          item.evidence,
        );
      }
      break;
    case 'table':
      for (const row of block.rows) {
        const first = block.columns
          .map((c) => row.cells[c.id])
          .find((c) => c !== undefined);
        add(
          map,
          ctx,
          {
            id: row.id,
            kind: 'row',
            title: typeof first === 'string' ? first : first?.text ?? row.id,
            fields: block.columns.flatMap((col) => {
              const cell = row.cells[col.id];
              const text = typeof cell === 'string' ? cell : cell?.text;
              return text ? [{ label: col.label, text }] : [];
            }),
            hasStatus: false,
          },
          row.evidence,
        );
      }
      break;
    case 'mermaid':
    case 'prose':
      break;
  }
}

export function buildEntityIndex(bundle: Bundle): Map<string, EntityRecord> {
  const map = new Map<string, EntityRecord>();
  for (const page of bundle.viewer.pages) {
    for (const block of page.blocks) indexBlock(map, block, page.id, page.title);
  }
  for (const term of bundle.viewer.glossary ?? []) {
    map.set(term.id, {
      id: term.id,
      kind: 'glossary',
      title: term.term,
      fields: narrative(
        [
          ['쉬운 말로', term.easy],
          ['기술적으로는', term.tech],
        ],
        term.fields,
      ),
      evidence: term.evidence,
      inherited: false,
      hasStatus: false,
    });
  }
  return map;
}

// 근거 참조는 Bundle 안에서 resolved가 채워진 형태로 들어온다. 타입은 선택이라 여기서 좁힌다.
export function resolvedOf(ref: EvidenceRef): ResolvedTarget | null {
  const maybe = (ref as { resolved?: ResolvedTarget }).resolved;
  return maybe ?? null;
}

export function sourceSpec(bundle: Bundle, id: string): SourceSpec | undefined {
  return bundle.viewer.sources.find((s) => s.id === id);
}

// 버튼에 보일 이름: label이 있으면 그것, 없으면 "문서 제목 › 절".
export function refLabel(bundle: Bundle, ref: EvidenceRef): string {
  if (ref.label) return ref.label;
  const title = bundle.docs[ref.source]?.title ?? sourceSpec(bundle, ref.source)?.title ?? ref.source;
  const section = ref.at ?? (ref.find ? `"${ref.find}"` : ref.lines ? `${ref.lines}줄` : undefined);
  return section ? `${title} › ${section}` : title;
}
