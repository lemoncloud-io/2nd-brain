import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { GraphBlock, ProseBlock } from '../../model/types.ts';
import { DEFAULT_FILES, MINIMAL, assertIssue, codes, resolvedOf, run, viewerYml } from './helpers.ts';

const LEDGER_YML = [
  'schema_version: 1',
  'statuses:',
  '  not_run: {label: 미실행, tone: muted}',
  'default: not_run',
  '',
].join('\n');

function withBlocks(blockLines: string[], sourceLines?: string[]): string {
  return viewerYml(
    [
      'sources:',
      ...(sourceLines ?? ['  - {id: spec, path: docs/spec.md, role: primary, kind: doc}']),
      'pages:',
      '  - id: P1',
      '    title: 개요',
      '    blocks:',
      ...blockLines,
    ].join('\n'),
  );
}

test('정상 뷰어는 오류 없이 통과하고 근거 자리가 해소된다', () => {
  const result = run(MINIMAL);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  const block = result.viewer!.pages[0]!.blocks[0] as ProseBlock;
  // frontmatter 4줄을 건너뛴 파일 기준 줄 번호여야 한다.
  assert.deepEqual(resolvedOf(block.evidence), {
    source: 'spec',
    slug: '검사-규칙',
    line: 14,
    verified: true,
  });
});

test('중복 id는 실패한다', () => {
  const result = run(
    withBlocks([
      '      - type: graph',
      '        id: B1',
      '        evidence: [{source: spec}]',
      '        nodes:',
      '          - {id: N1, label: 입력부}',
      '          - {id: N1, label: 처리부}',
    ]),
  );
  assert.equal(result.ok, false);
  assertIssue(result, 'E_DUP_ID', 'pages[0].blocks[0].nodes[1].id');
});

test('끊긴 엣지는 실패한다', () => {
  const result = run(
    withBlocks([
      '      - type: graph',
      '        id: B1',
      '        evidence: [{source: spec}]',
      '        nodes:',
      '          - {id: N1, label: 입력부}',
      '        edges:',
      '          - {from: N1, to: N9}',
    ]),
  );
  assertIssue(result, 'E_BROKEN_REF', 'pages[0].blocks[0].edges[0].to');
});

test('끊긴 refs는 실패한다', () => {
  const result = run(
    withBlocks([
      '      - type: items',
      '        id: B1',
      '        evidence: [{source: spec}]',
      '        items:',
      '          - {id: I1, label: 첫 항목, refs: [I9]}',
    ]),
  );
  assertIssue(result, 'E_BROKEN_REF', 'pages[0].blocks[0].items[0].refs[0]');
});

test('해설 필드가 있는데 자기 근거도 블록 근거도 없으면 실패한다', () => {
  const result = run(
    withBlocks([
      '      - type: graph',
      '        id: B1',
      '        nodes:',
      '          - {id: N1, label: 입력부, easy: 자료를 받는 곳이다}',
    ]),
  );
  assertIssue(result, 'E_NO_EVIDENCE', 'pages[0].blocks[0].nodes[0]');
});

// 경고를 블록 단위로 모으기로 했으므로 where가 노드 자리에서 블록 자리로 옮겨 갔다.
test('블록 근거는 물려받고 경고로 집계된다', () => {
  const result = run(
    withBlocks([
      '      - type: graph',
      '        id: B1',
      '        evidence: [{source: spec, at: "구성 단위"}]',
      '        nodes:',
      '          - {id: N1, label: 입력부, easy: 자료를 받는 곳이다}',
      '          - {id: N2, label: 처리부, easy: 자료를 다듬는 곳이다, evidence: [{source: spec}]}',
    ]),
  );
  assert.equal(result.ok, true);
  const issue = assertIssue(result, 'W_INHERITED', 'pages[0].blocks[0]');
  assert.equal(issue.message, '블록 근거를 물려받은 항목 1개 (노드 1)');
  assert.equal(issue.count, 1);
  assert.equal(result.inheritedEvidence, 1);
  assert.equal(codes(result).filter((c) => c === 'W_INHERITED').length, 1);
});

test('한 블록이 여러 종류를 물려주면 경고는 한 건이고 종류별 수가 붙는다', () => {
  const result = run(
    withBlocks([
      '      - type: stages',
      '        id: B1',
      '        evidence: [{source: spec, at: "구성 단위"}]',
      '        stages:',
      '          - id: S1',
      '            title: 첫 단계',
      '            question: 무엇을 보는가',
      '            items:',
      '              - {id: S1.C1, label: 첫 항목, criteria: 로그가 남는다}',
      '              - {id: S1.C2, label: 둘째 항목, criteria: 오류가 없다}',
    ]),
  );
  assert.equal(result.ok, true);
  const issue = assertIssue(result, 'W_INHERITED', 'pages[0].blocks[0]');
  assert.equal(issue.message, '블록 근거를 물려받은 항목 3개 (단계 1 · 항목 2)');
  assert.equal(issue.count, 3);
  assert.equal(result.inheritedEvidence, 3);
  assert.equal(codes(result).filter((c) => c === 'W_INHERITED').length, 1);
});

test('블록이 둘이면 경고도 둘이고 블록 순서를 지킨다', () => {
  const result = run(
    withBlocks([
      '      - type: graph',
      '        id: B1',
      '        evidence: [{source: spec, at: "구성 단위"}]',
      '        nodes:',
      '          - {id: N1, label: 입력부, easy: 자료를 받는 곳이다}',
      '          - {id: N2, label: 처리부, easy: 자료를 다듬는 곳이다}',
      '      - type: items',
      '        id: B2',
      '        evidence: [{source: spec, at: "검사 규칙"}]',
      '        items:',
      '          - {id: I1, label: 첫 항목, body: 규칙을 하나 더한다}',
    ]),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.issues.filter((i) => i.code === 'W_INHERITED').map((i) => `${i.where} ${i.count}`),
    ['pages[0].blocks[0] 2', 'pages[0].blocks[1] 1'],
  );
  assert.equal(result.inheritedEvidence, 3);
});

test('물려받은 항목이 없는 블록은 경고를 내지 않는다', () => {
  const result = run(
    withBlocks([
      '      - type: graph',
      '        id: B1',
      '        evidence: [{source: spec, at: "구성 단위"}]',
      '        nodes:',
      '          - {id: N1, label: 입력부, easy: 자료를 받는 곳이다, evidence: [{source: spec}]}',
      '          - {id: N2, label: 처리부}',
    ]),
  );
  assert.deepEqual(result.issues, []);
  assert.equal(result.inheritedEvidence, 0);
});

test('용어는 블록이 없으므로 자기 근거가 비면 실패한다', () => {
  const text = viewerYml(
    [
      'sources:',
      '  - {id: spec, path: docs/spec.md, role: primary, kind: doc}',
      'glossary:',
      '  - {id: G1, term: 진실원, easy: 내용의 원래 자리다, evidence: []}',
      'pages:',
      '  - id: P1',
      '    title: 개요',
      '    blocks:',
      '      - type: prose',
      '        text: 요약이다.',
      '        evidence: [{source: spec}]',
    ].join('\n'),
  );
  assertIssue(run(text), 'E_NO_EVIDENCE', 'glossary[0]');
});

test('viewer.yml에 상태 값을 쓰면 실패한다', () => {
  const result = run(
    withBlocks([
      '      - type: items',
      '        id: B1',
      '        evidence: [{source: spec}]',
      '        items:',
      '          - {id: I1, label: 첫 항목, status: passed}',
    ]),
  );
  assert.equal(result.ok, false);
  assertIssue(result, 'E_SCHEMA', 'pages[0].blocks[0].items[0].status');
});

test('primary 원본이 없으면 실패한다', () => {
  const result = run(
    withBlocks(
      [
        '      - type: prose',
        '        text: 요약이다.',
        '        evidence: [{source: spec}]',
      ],
      ['  - {id: spec, path: docs/gone.md, role: primary, kind: doc}'],
    ),
  );
  assertIssue(result, 'E_SOURCE_MISSING', 'sources[0]');
});

test('reference 원본이 없으면 경고에 그친다', () => {
  const result = run(
    withBlocks(
      [
        '      - type: prose',
        '        text: 요약이다.',
        '        evidence: [{source: spec}]',
      ],
      [
        '  - {id: spec, path: docs/spec.md, role: primary, kind: doc}',
        '  - {id: extra, path: docs/gone.md, role: reference, kind: doc}',
      ],
    ),
  );
  assert.equal(result.ok, true);
  assertIssue(result, 'W_REFERENCE_MISSING', 'sources[1]');
});

test('절대경로는 실패한다', () => {
  const result = run(
    withBlocks(
      ['      - type: prose', '        text: 요약이다.', '        evidence: [{source: spec}]'],
      ['  - {id: spec, path: /etc/hosts, role: primary, kind: doc}'],
    ),
  );
  assertIssue(result, 'E_PATH', 'sources[0].path');
});

test('.. 탈출은 실패한다', () => {
  const result = run(
    withBlocks(
      ['      - type: prose', '        text: 요약이다.', '        evidence: [{source: spec}]'],
      ['  - {id: spec, path: ../밖/파일.md, role: primary, kind: doc}'],
    ),
  );
  assertIssue(result, 'E_PATH', 'sources[0].path');
});

test('sources에 없는 원본 id를 가리키면 실패한다', () => {
  const result = run(
    withBlocks([
      '      - type: prose',
      '        text: 요약이다.',
      '        evidence: [{source: ghost}]',
    ]),
  );
  assertIssue(result, 'E_SOURCE_UNKNOWN', 'pages[0].blocks[0].evidence[0].source');
});

test('해소되지 않는 근거는 실패한다', () => {
  const result = run(
    withBlocks([
      '      - type: prose',
      '        text: 요약이다.',
      '        evidence: [{source: spec, at: "없는 절"}]',
    ]),
  );
  assertIssue(result, 'E_REF_UNRESOLVED', 'pages[0].blocks[0].evidence[0]');
});

test('ledger 원본이 둘이면 실패한다', () => {
  const files = { ...DEFAULT_FILES, 'docs/a.yml': LEDGER_YML, 'docs/b.yml': LEDGER_YML };
  const result = run(
    withBlocks(
      ['      - type: prose', '        text: 요약이다.', '        evidence: [{source: spec}]'],
      [
        '  - {id: spec, path: docs/spec.md, role: primary, kind: doc}',
        '  - {id: led-a, path: docs/a.yml, role: ledger, kind: data}',
        '  - {id: led-b, path: docs/b.yml, role: ledger, kind: data}',
      ],
    ),
    files,
  );
  assertIssue(result, 'E_KIND', 'sources[2].role');
});

test('expect_count가 실제 수와 다르면 실패한다', () => {
  const result = run(
    withBlocks([
      '      - type: items',
      '        id: B1',
      '        expect_count: 3',
      '        evidence: [{source: spec}]',
      '        items:',
      '          - {id: I1, label: 첫 항목}',
    ]),
  );
  assertIssue(result, 'E_COUNT', 'pages[0].blocks[0].expect_count');
});

test('tree의 순환은 실패한다', () => {
  const result = run(
    withBlocks([
      '      - type: tree',
      '        id: B1',
      '        evidence: [{source: spec}]',
      '        nodes:',
      '          - {id: T1, label: 하나, parent: T2}',
      '          - {id: T2, label: 둘, parent: T1}',
    ]),
  );
  assertIssue(result, 'E_TREE_CYCLE', 'pages[0].blocks[0].nodes');
});

test('tree의 끊긴 parent는 실패한다', () => {
  const result = run(
    withBlocks([
      '      - type: tree',
      '        id: B1',
      '        evidence: [{source: spec}]',
      '        nodes:',
      '          - {id: T1, label: 하나, parent: T9}',
    ]),
  );
  assertIssue(result, 'E_BROKEN_REF', 'pages[0].blocks[0].nodes[0].parent');
});

test('graph 노드의 끊긴 group은 실패한다', () => {
  const result = run(
    withBlocks([
      '      - type: graph',
      '        id: B1',
      '        evidence: [{source: spec}]',
      '        groups: [{id: G-in, label: 입력}]',
      '        nodes:',
      '          - {id: N1, label: 입력부, group: G-out}',
    ]),
  );
  assertIssue(result, 'E_BROKEN_REF', 'pages[0].blocks[0].nodes[0].group');
});

const REPO_SOURCES = [
  '  - {id: spec, path: docs/spec.md, role: primary, kind: doc}',
  '  - id: engine',
  '    path: src/engine.ts',
  '    role: reference',
  '    kind: code',
  '    repo: acme/engine',
  '    commit: 0123456789ab',
];

const REPO_BLOCK = [
  '      - type: prose',
  '        text: 엔진은 큐를 하나만 쓴다.',
  '        evidence: [{source: engine, lines: "2-3"}]',
];

test('저장소 코드를 로컬에서 못 읽으면 경고로 집계하고 verified가 false다', () => {
  const result = run(withBlocks(REPO_BLOCK, REPO_SOURCES));
  assert.equal(result.ok, true);
  assertIssue(result, 'W_CODE_UNVERIFIED', 'pages[0].blocks[0].evidence[0]');
  assert.equal(result.unverifiedCode, 1);
  const block = result.viewer!.pages[0]!.blocks[0] as ProseBlock;
  assert.equal(resolvedOf(block.evidence).verified, false);
});

test('저장소 코드를 읽을 수 있으면 줄 범위를 실제로 검사한다', () => {
  const readRepoFile = (repo: string, p: string): string | null =>
    repo === 'acme/engine' && p === 'src/engine.ts' ? 'a\nb\nc\n' : null;
  const ok = run(withBlocks(REPO_BLOCK, REPO_SOURCES), undefined, readRepoFile);
  assert.deepEqual(ok.issues, []);
  const block = ok.viewer!.pages[0]!.blocks[0] as ProseBlock;
  assert.equal(resolvedOf(block.evidence).verified, true);

  const bad = run(
    withBlocks(
      [
        '      - type: prose',
        '        text: 엔진은 큐를 하나만 쓴다.',
        '        evidence: [{source: engine, lines: "40-52"}]',
      ],
      REPO_SOURCES,
    ),
    undefined,
    readRepoFile,
  );
  assertIssue(bad, 'E_REF_UNRESOLVED', 'pages[0].blocks[0].evidence[0]');
});

test('오류는 첫 건에서 멈추지 않고 모두 모인다', () => {
  const result = run(
    withBlocks([
      '      - type: graph',
      '        id: B1',
      '        nodes:',
      '          - {id: N1, label: 입력부, easy: 자료를 받는 곳이다}',
      '          - {id: N2, label: 처리부, easy: 자료를 다듬는 곳이다}',
      '        edges:',
      '          - {from: N1, to: N9}',
    ]),
  );
  assert.deepEqual(codes(result).sort(), ['E_BROKEN_REF', 'E_NO_EVIDENCE', 'E_NO_EVIDENCE']);
});

test('표의 행은 행·셀·블록 중 한 곳에만 근거가 있으면 된다', () => {
  const okResult = run(
    withBlocks([
      '      - type: table',
      '        id: B1',
      '        columns: [{id: c1, label: 항목}, {id: c2, label: 해석, derived: true}]',
      '        rows:',
      '          - id: R1',
      '            cells: {c1: 입력부, c2: {text: 자료를 받는다, evidence: [{source: spec}]}}',
    ]),
  );
  assert.deepEqual(okResult.issues, []);

  const bad = run(
    withBlocks([
      '      - type: table',
      '        id: B1',
      '        columns: [{id: c1, label: 항목}]',
      '        rows:',
      '          - {id: R1, cells: {c1: 입력부}}',
    ]),
  );
  assertIssue(bad, 'E_NO_EVIDENCE', 'pages[0].blocks[0].rows[0]');
});

test('mermaid와 prose 블록은 블록 근거가 필수다', () => {
  const result = run(
    withBlocks(['      - type: mermaid', '        id: B1', '        code: "graph TD; A-->B"']),
  );
  assertIssue(result, 'E_NO_EVIDENCE', 'pages[0].blocks[0]');
});

test('YAML 오류면 나머지 검사를 하지 않는다', () => {
  const result = run('schema_version: 1\nmeta: [\n');
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['E_YAML']);
  assert.equal(result.viewer, undefined);
});

test('노드 라벨만 있고 해설이 없으면 근거가 없어도 된다', () => {
  const result = run(
    withBlocks([
      '      - type: graph',
      '        id: B1',
      '        nodes:',
      '          - {id: N1, label: 입력부, tag: 외부}',
      '          - {id: N2, label: 처리부}',
      '        edges: [{from: N1, to: N2, style: dashed, both: true}]',
    ]),
  );
  assert.deepEqual(result.issues, []);
  const block = result.viewer!.pages[0]!.blocks[0] as GraphBlock;
  assert.equal(block.nodes.length, 2);
});
