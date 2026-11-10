// stages의 parent·after 검사. 둘 다 선택 필드이고, 없으면 지금 검사 결과가 그대로여야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { StagesBlock } from '../../model/types.ts';
import { assertIssue, codes, run, viewerYml } from './helpers.ts';

function stagesViewer(stageLines: string[]): string {
  return viewerYml(
    [
      'sources:',
      '  - {id: spec, path: docs/spec.md, role: primary, kind: doc}',
      'pages:',
      '  - id: p1',
      '    title: 단계',
      '    blocks:',
      '      - type: stages',
      '        id: blk',
      '        stages:',
      ...stageLines,
    ].join('\n'),
  );
}

const W = 'pages[0].blocks[0]';

test('parent·after가 같은 블록의 단계를 가리키면 통과하고 값이 그대로 실린다', () => {
  const result = run(
    stagesViewer([
      '          - {id: M1, title: 첫 마일스톤}',
      '          - {id: M2, title: 둘째 마일스톤}',
      '          - {id: B1, title: 첫 묶음, parent: M2}',
      '          - {id: B2, title: 둘째 묶음, parent: M2, after: [B1]}',
    ]),
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  const block = result.viewer!.pages[0]!.blocks[0] as StagesBlock;
  assert.equal(block.stages[2]!.parent, 'M2');
  assert.deepEqual(block.stages[3]!.after, ['B1']);
});

test('없는 parent는 E_BROKEN_REF', () => {
  const result = run(stagesViewer(['          - {id: S1, title: 하나, parent: S9}']));
  const issue = assertIssue(result, 'E_BROKEN_REF', `${W}.stages[0].parent`);
  assert.match(issue.message, /S9/);
});

test('다른 블록 종류의 id를 parent로 가리켜도 E_BROKEN_REF — 같은 블록의 단계만 된다', () => {
  const result = run(
    stagesViewer([
      '          - id: S1',
      '            title: 하나',
      '            items: [{id: S1.C1, label: 항목}]',
      '          - {id: S2, title: 둘, parent: S1.C1}',
    ]),
  );
  assertIssue(result, 'E_BROKEN_REF', `${W}.stages[1].parent`);
});

test('parent가 이미 하위 단계면 E_BROKEN_REF — 한 단만 중첩한다', () => {
  const result = run(
    stagesViewer([
      '          - {id: S1, title: 하나}',
      '          - {id: S2, title: 둘, parent: S1}',
      '          - {id: S3, title: 셋, parent: S2}',
    ]),
  );
  const issue = assertIssue(result, 'E_BROKEN_REF', `${W}.stages[2].parent`);
  assert.match(issue.message, /최상위/);
});

test('자기 자신을 parent로 두면 E_TREE_CYCLE', () => {
  const result = run(stagesViewer(['          - {id: S1, title: 하나, parent: S1}']));
  assertIssue(result, 'E_TREE_CYCLE', `${W}.stages[0].parent`);
});

test('parent가 서로를 가리키면 순환이 아니라 중첩 규칙으로 걸린다', () => {
  const result = run(
    stagesViewer([
      '          - {id: S1, title: 하나, parent: S2}',
      '          - {id: S2, title: 둘, parent: S1}',
    ]),
  );
  assert.equal(result.ok, false);
  assertIssue(result, 'E_BROKEN_REF', `${W}.stages[0].parent`);
  assertIssue(result, 'E_BROKEN_REF', `${W}.stages[1].parent`);
});

test('없는 after는 E_BROKEN_REF이고 위치에 순번이 붙는다', () => {
  const result = run(
    stagesViewer([
      '          - {id: S1, title: 하나}',
      '          - {id: S2, title: 둘, after: [S1, S7]}',
    ]),
  );
  const issue = assertIssue(result, 'E_BROKEN_REF', `${W}.stages[1].after[1]`);
  assert.match(issue.message, /S7/);
  assert.equal(codes(result).filter((c) => c === 'E_BROKEN_REF').length, 1);
});

test('after의 순환은 E_TREE_CYCLE이고 메시지에 경로가 나온다', () => {
  const result = run(
    stagesViewer([
      '          - {id: S1, title: 하나, after: [S3]}',
      '          - {id: S2, title: 둘, after: [S1]}',
      '          - {id: S3, title: 셋, after: [S2]}',
    ]),
  );
  const issue = assertIssue(result, 'E_TREE_CYCLE', `${W}.stages`);
  assert.equal(issue.message, 'stages의 after에 순환이 있다: S1 → S3 → S2 → S1');
});

test('자기 자신을 after로 두면 순환이다', () => {
  const result = run(stagesViewer(['          - {id: S1, title: 하나, after: [S1]}']));
  assertIssue(result, 'E_TREE_CYCLE', `${W}.stages`);
});

test('after 형식이 id가 아니면 E_SCHEMA', () => {
  const result = run(stagesViewer(['          - {id: S1, title: 하나, after: ["1abc"]}']));
  assert.ok(codes(result).includes('E_SCHEMA'));
});
