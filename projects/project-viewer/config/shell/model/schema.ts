// zod 3 스키마. 모든 객체는 .strict() — 오탈자가 조용히 통과하지 못하게 하기 위해서다.
// 파일 끝의 컴파일 타임 단언이 types.ts(정본)와 z.infer의 어긋남을 잡는다.
import { z } from 'zod';

import type { Block, EvidenceRef, LedgerDoc, LedgerRef, ViewerDoc } from './types.ts';

/** 뷰어 전체에서 유일한 id. */
const ID = /^[A-Za-z][A-Za-z0-9._-]*$/;
/** 원본 id는 따로 센다. */
const SOURCE_ID = /^[a-z0-9][a-z0-9-]*$/;
const COLUMN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const LINES = /^\d+(?:-\d+)?$/;
const REPO = /^[^/\s]+\/[^/\s]+$/;

const id = () => z.string().regex(ID, 'id 형식은 ^[A-Za-z][A-Za-z0-9._-]*$ 이다');
const sourceId = () => z.string().regex(SOURCE_ID, '원본 id 형식은 ^[a-z0-9][a-z0-9-]*$ 이다');

export const toneSchema = z.enum(['muted', 'blue', 'amber', 'green', 'red']);

/** at·lines·find는 동시에 둘 이상 쓸 수 없다. */
function atMostOneAnchor(v: { at?: string; lines?: string; find?: string }): boolean {
  return [v.at, v.lines, v.find].filter((x) => x !== undefined).length <= 1;
}
const ANCHOR_MESSAGE = { message: 'at·lines·find는 함께 쓸 수 없다' };

export const evidenceRefSchema = z
  .object({
    source: sourceId(),
    at: z.string().optional(),
    lines: z.string().regex(LINES, '줄 범위는 "40" 또는 "40-52" 형식이다').optional(),
    find: z.string().optional(),
    label: z.string().optional(),
  })
  .strict()
  .refine(atMostOneAnchor, ANCHOR_MESSAGE);

export const fieldSchema = z.object({ label: z.string(), text: z.string() }).strict();

export const statusDefSchema = z
  .object({
    label: z.string(),
    tone: toneSchema,
    done: z.boolean().optional(),
    motion: z.enum(['pulse']).optional(),
    struck: z.boolean().optional(),
  })
  .strict();

export const sourceSchema = z
  .object({
    id: sourceId(),
    path: z.string().min(1),
    title: z.string().optional(),
    group: z.string().optional(),
    role: z.enum(['primary', 'reference', 'ledger']),
    kind: z.enum(['doc', 'code', 'data']).default('doc'),
    repo: z.string().regex(REPO, 'repo는 "<org>/<name>" 형식이다').optional(),
    commit: z.string().optional(),
    url_base: z.string().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.repo !== undefined && v.kind !== 'code') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['repo'], message: 'repo는 kind: code에서만 쓴다' });
    }
    if (v.repo === undefined && (v.commit !== undefined || v.url_base !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [v.commit !== undefined ? 'commit' : 'url_base'],
        message: 'commit·url_base는 repo가 있을 때만 쓴다',
      });
    }
  });

// ── 블록 ─────────────────────────────────────────────────────────────────────
const blockBase = {
  id: id().optional(),
  title: z.string().optional(),
  intro: z.string().optional(),
  evidence: z.array(evidenceRefSchema).optional(),
};
const narrative = {
  easy: z.string().optional(),
  tech: z.string().optional(),
  fields: z.array(fieldSchema).optional(),
  evidence: z.array(evidenceRefSchema).optional(),
};

export const graphBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('graph'),
    groups: z.array(z.object({ id: id(), label: z.string() }).strict()).optional(),
    nodes: z.array(
      z.object({ id: id(), label: z.string(), group: z.string().optional(), tag: z.string().optional(), ...narrative }).strict(),
    ),
    edges: z
      .array(
        z
          .object({
            from: z.string(),
            to: z.string(),
            label: z.string().optional(),
            style: z.enum(['solid', 'dashed']).optional(),
            both: z.boolean().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const treeBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('tree'),
    nodes: z.array(
      z.object({ id: id(), label: z.string(), parent: z.string().optional(), tag: z.string().optional(), ...narrative }).strict(),
    ),
  })
  .strict();

export const sequenceBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('sequence'),
    fields: z.array(fieldSchema).optional(),
    steps: z.array(
      z
        .object({
          id: id(),
          label: z.string(),
          lane: z.string().optional(),
          why: z.string().optional(),
          ...narrative,
        })
        .strict(),
    ),
  })
  .strict();

export const stagesBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('stages'),
    stages: z.array(
      z
        .object({
          id: id(),
          title: z.string(),
          short: z.string().optional(),
          question: z.string().optional(),
          owner: z.string().optional(),
          output: z.string().optional(),
          stop: z.string().optional(),
          fields: z.array(fieldSchema).optional(),
          detail: evidenceRefSchema.optional(),
          status_from: z.object({ source: sourceId() }).strict().optional(),
          parent: id().optional(),
          after: z.array(id()).optional(),
          items: z
            .array(
              z
                .object({
                  id: id(),
                  label: z.string(),
                  required: z.boolean().optional(),
                  criteria: z.string().optional(),
                  fields: z.array(fieldSchema).optional(),
                  evidence: z.array(evidenceRefSchema).optional(),
                })
                .strict(),
            )
            .optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const itemsBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('items'),
    expect_count: z.number().int().nonnegative().optional(),
    items: z.array(
      z
        .object({
          id: id(),
          label: z.string(),
          body: z.string().optional(),
          tags: z.array(z.string()).optional(),
          refs: z.array(z.string()).optional(),
          fields: z.array(fieldSchema).optional(),
          evidence: z.array(evidenceRefSchema).optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const cellSchema = z.union([
  z.string(),
  z.object({ text: z.string(), evidence: z.array(evidenceRefSchema).optional() }).strict(),
]);

export const tableBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('table'),
    expect_count: z.number().int().nonnegative().optional(),
    columns: z.array(
      z.object({ id: z.string().regex(COLUMN_ID), label: z.string(), derived: z.boolean().optional() }).strict(),
    ),
    rows: z.array(
      z
        .object({
          id: id(),
          cells: z.record(z.string(), cellSchema),
          evidence: z.array(evidenceRefSchema).optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const mermaidBlockSchema = z.object({ ...blockBase, type: z.literal('mermaid'), code: z.string() }).strict();
export const proseBlockSchema = z.object({ ...blockBase, type: z.literal('prose'), text: z.string() }).strict();

export const blockSchema = z.discriminatedUnion('type', [
  graphBlockSchema,
  treeBlockSchema,
  sequenceBlockSchema,
  stagesBlockSchema,
  itemsBlockSchema,
  tableBlockSchema,
  mermaidBlockSchema,
  proseBlockSchema,
]);

export const pageSchema = z
  .object({
    id: id(),
    title: z.string(),
    layout: z.enum(['stack', 'tabs']).optional(),
    blocks: z.array(blockSchema),
  })
  .strict();

export const glossaryTermSchema = z
  .object({
    id: id(),
    term: z.string(),
    easy: z.string(),
    tech: z.string().optional(),
    fields: z.array(fieldSchema).optional(),
    evidence: z.array(evidenceRefSchema),
  })
  .strict();

export const viewerSchema = z
  .object({
    schema_version: z.literal(1),
    meta: z
      .object({
        title: z.string(),
        kind: z.enum(['project', 'explainer']),
        audience: z.string().optional(),
        summary: z.string().optional(),
      })
      .strict(),
    sources: z.array(sourceSchema),
    statuses: z.record(z.string(), statusDefSchema).optional(),
    glossary: z.array(glossaryTermSchema).optional(),
    pages: z.array(pageSchema),
  })
  .strict();

// ── 상태 원장 ────────────────────────────────────────────────────────────────
export const ledgerRefSchema = z
  .object({
    path: z.string().min(1),
    at: z.string().optional(),
    lines: z.string().regex(LINES).optional(),
    find: z.string().optional(),
    label: z.string().optional(),
  })
  .strict()
  .refine(atMostOneAnchor, ANCHOR_MESSAGE);

export const ledgerEntrySchema = z
  .object({
    status: z.string().min(1),
    note: z.string().optional(),
    evidence: z.array(ledgerRefSchema).optional(),
  })
  .strict();

export const ledgerSchema = z
  .object({
    schema_version: z.literal(1),
    statuses: z.record(z.string(), statusDefSchema),
    default: z.string().min(1),
    defaults: z.array(z.object({ match: z.string().min(1), status: z.string().min(1) }).strict()).optional(),
    stages: z.record(z.string(), ledgerEntrySchema).optional(),
    items: z.record(z.string(), ledgerEntrySchema).optional(),
  })
  .strict();

// ── types.ts와의 어긋남을 컴파일 타임에 잡는다 ──────────────────────────────
// 양방향 대입 가능성을 본다. 한쪽이라도 어긋나면 false가 되어 Expect에서 컴파일 오류가 난다.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

export type _AssertEvidenceRef = Expect<Same<z.infer<typeof evidenceRefSchema>, EvidenceRef>>;
export type _AssertLedgerRef = Expect<Same<z.infer<typeof ledgerRefSchema>, LedgerRef>>;
export type _AssertBlock = Expect<Same<z.infer<typeof blockSchema>, Block>>;
export type _AssertViewerDoc = Expect<Same<z.infer<typeof viewerSchema>, ViewerDoc>>;
export type _AssertLedgerDoc = Expect<Same<z.infer<typeof ledgerSchema>, LedgerDoc>>;
