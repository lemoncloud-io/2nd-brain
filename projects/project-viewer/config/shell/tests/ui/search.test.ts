import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSearchIndex, search } from '../../src/app/search.ts';
import { formatRoute } from '../../src/app/router.ts';
import type { Bundle } from '../../model/types.ts';

const bundle: Bundle = {
  viewer: {
    schema_version: 1,
    meta: { title: '보기 도구', kind: 'project' },
    sources: [{ id: 'spec', path: 'docs/design.md', role: 'primary', kind: 'doc' }],
    glossary: [
      {
        id: 'g.ledger',
        term: '상태 원장',
        easy: '단계 상태를 적는 프로젝트 소유 문서',
        evidence: [{ source: 'spec' }],
      },
    ],
    pages: [
      {
        id: 'overview',
        title: '한눈에',
        blocks: [
          {
            type: 'graph',
            nodes: [
              { id: 'n.collect', label: '수집기', easy: '원본을 빌드 때 읽는다' },
              { id: 'n.check', label: '검사기', tech: 'zod 스키마로 모르는 키를 막는다' },
            ],
          },
          {
            type: 'stages',
            stages: [
              {
                id: 'S1',
                title: '종이 이식',
                question: '블록 어휘가 충분한가',
                items: [{ id: 'S1.C1', label: '집계표 작성', criteria: '화면별로 센다' }],
              },
            ],
          },
          {
            type: 'items',
            items: [{ id: 'F4', label: '링크 결함', body: 'iframe에서 해시가 먹지 않는다' }],
          },
          {
            type: 'table',
            columns: [{ id: 'c1', label: '발견' }],
            rows: [{ id: 'R1', cells: { c1: '좌표 하드코딩' } }],
          },
        ],
      },
    ],
  },
  docs: {
    spec: {
      id: 'spec',
      path: 'docs/design.md',
      role: 'primary',
      kind: 'doc',
      title: '설계',
      frontmatter: {},
      body: '# 설계\n\n원본은 빌드 때 직접 읽는다. 해시 라우터를 공용화한다.\n',
      digest: 'abc123abc123',
      headings: [{ depth: 1, text: '설계', slug: '설계', line: 1 }],
      missing: false,
      embedded: true,
    },
  },
  status: {},
  backlinks: {},
  stamp: {
    builtAt: '2026-09-19T00:00:00.000Z',
    commit: null,
    dirty: false,
    docCount: 1,
    ymlDigest: 'aaaaaaaaaaaa',
    ledgerDigest: null,
    counts: { unresolvedLinks: 0, missingReferences: 0, unverifiedCode: 0, inheritedEvidence: 0 },
  },
  issues: [],
};

const index = buildSearchIndex(bundle);

test('빈 질의와 공백만 있는 질의는 결과가 없다', () => {
  assert.deepEqual(search(index, ''), []);
  assert.deepEqual(search(index, '   '), []);
});

test('페이지 항목에서 찾는다 — 노드·단계·항목·행·용어·원본이 모두 색인된다', () => {
  const kinds = (q: string) => search(index, q).map((h) => h.entry.kind);
  assert.equal(kinds('수집기').includes('node'), true, '그래프 노드를 못 찾는다');
  assert.equal(kinds('종이 이식').includes('stage'), true, '단계를 못 찾는다');
  assert.equal(kinds('집계표').includes('stage-item'), true, '단계 항목을 못 찾는다');
  assert.equal(kinds('링크 결함').includes('item'), true, '항목을 못 찾는다');
  assert.equal(kinds('좌표 하드코딩').includes('row'), true, '표의 행을 못 찾는다');
});

test('용어와 원본 본문에서도 찾는다', () => {
  assert.equal(search(index, '상태 원장').some((h) => h.entry.kind === 'glossary'), true);
  assert.equal(search(index, '해시 라우터').some((h) => h.entry.kind === 'doc'), true);
});

test('해설 본문(easy·tech·body·criteria)도 검색 대상이다', () => {
  assert.equal(search(index, 'zod 스키마').some((h) => h.entry.id === 'n.check'), true);
  assert.equal(search(index, 'iframe').some((h) => h.entry.id === 'F4'), true);
});

test('대소문자를 무시한다', () => {
  const lower = search(index, 'iframe').map((h) => h.entry.id);
  const upper = search(index, 'IFRAME').map((h) => h.entry.id);
  assert.deepEqual(upper, lower);
  assert.equal(upper.length > 0, true);
});

test('모든 결과가 열 수 있는 경로를 갖는다', () => {
  const hits = search(index, '검사기').concat(search(index, '설계'), search(index, '원장'));
  assert.equal(hits.length > 0, true);
  for (const hit of hits) {
    const hash = formatRoute(hit.entry.route);
    assert.equal(hash.startsWith('#/'), true, `경로가 없다: ${hit.entry.id}`);
    assert.notEqual(hash, '#/', `첫 페이지로만 가는 결과가 있다: ${hit.entry.id}`);
  }
});

test('결과에 질의가 들어간 미리보기 조각이 붙는다', () => {
  const hit = search(index, 'iframe')[0]!;
  assert.equal(hit.snippet.toLowerCase().includes('iframe'), true);
});

test('찾지 못하면 빈 배열이다', () => {
  assert.deepEqual(search(index, '없는말없는말'), []);
});

test('제목이 맞은 결과가 본문만 맞은 결과보다 앞에 온다', () => {
  const hits = search(index, '검사기');
  assert.equal(hits[0]!.entry.id, 'n.check');
});
