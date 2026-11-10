import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ModelError, parseViewer } from '../../model/parse.ts';
import { MINIMAL, assertIssue, run, viewerYml } from './helpers.ts';

function issuesOf(text: string): { code: string; where: string }[] {
  try {
    parseViewer(text);
    return [];
  } catch (err) {
    if (!(err instanceof ModelError)) throw err;
    return err.issues.map((i) => ({ code: i.code, where: i.where }));
  }
}

test('정상 yml은 통과한다', () => {
  const doc = parseViewer(MINIMAL);
  assert.equal(doc.schema_version, 1);
  assert.equal(doc.meta.kind, 'explainer');
  assert.equal(doc.pages[0]!.blocks[0]!.type, 'prose');
});

test('최상위의 모르는 키는 실패한다', () => {
  const found = issuesOf(`${MINIMAL}\nextra_key: 1\n`);
  assert.deepEqual(found, [{ code: 'E_SCHEMA', where: 'extra_key' }]);
});

test('블록 안의 모르는 키는 실패한다', () => {
  const text = viewerYml(
    [
      'sources:',
      '  - {id: spec, path: docs/spec.md, role: primary, kind: doc}',
      'pages:',
      '  - id: P1',
      '    title: 개요',
      '    blocks:',
      '      - type: prose',
      '        text: 요약',
      '        colour: red',
      '        evidence: [{source: spec}]',
    ].join('\n'),
  );
  const found = issuesOf(text);
  assert.deepEqual(found, [{ code: 'E_SCHEMA', where: 'pages[0].blocks[0].colour' }]);
});

test('schema_version이 없으면 실패한다', () => {
  const text = MINIMAL.split('\n').slice(1).join('\n');
  const found = issuesOf(text);
  assert.ok(
    found.some((i) => i.code === 'E_SCHEMA' && i.where === 'schema_version'),
    JSON.stringify(found),
  );
});

test('id 형식을 어기면 실패한다', () => {
  const text = viewerYml(
    [
      'sources:',
      '  - {id: spec, path: docs/spec.md, role: primary, kind: doc}',
      'pages:',
      '  - id: 1페이지',
      '    title: 개요',
      '    blocks:',
      '      - type: prose',
      '        text: 요약',
      '        evidence: [{source: spec}]',
    ].join('\n'),
  );
  assert.deepEqual(issuesOf(text), [{ code: 'E_SCHEMA', where: 'pages[0].id' }]);
});

test('원본 id는 소문자 규칙을 따른다', () => {
  const text = viewerYml(
    [
      'sources:',
      '  - {id: Spec, path: docs/spec.md, role: primary, kind: doc}',
      'pages:',
      '  - id: P1',
      '    title: 개요',
      '    blocks:',
      '      - type: prose',
      '        text: 요약',
      '        evidence: [{source: spec}]',
    ].join('\n'),
  );
  assert.deepEqual(issuesOf(text), [{ code: 'E_SCHEMA', where: 'sources[0].id' }]);
});

test('YAML 문법 오류는 E_YAML이다', () => {
  const found = issuesOf('schema_version: 1\nmeta: [\n');
  assert.equal(found.length, 1);
  assert.equal(found[0]!.code, 'E_YAML');
});

test('근거 참조에 at과 find를 함께 쓰면 실패한다', () => {
  const text = viewerYml(
    [
      'sources:',
      '  - {id: spec, path: docs/spec.md, role: primary, kind: doc}',
      'pages:',
      '  - id: P1',
      '    title: 개요',
      '    blocks:',
      '      - type: prose',
      '        text: 요약',
      '        evidence: [{source: spec, at: "검사 규칙", find: "유일한 문구"}]',
    ].join('\n'),
  );
  assert.deepEqual(issuesOf(text), [
    { code: 'E_SCHEMA', where: 'pages[0].blocks[0].evidence[0]' },
  ]);
});

// 이 규칙은 스키마가 아니라 checkProject가 본다 — 오류 코드표가 E_KIND로 정해 두었다.
test('kind: project인데 stages 블록이 없으면 E_KIND로 실패한다', () => {
  const text = MINIMAL.replace('kind: explainer', 'kind: project');
  const result = run(text);
  assert.equal(result.ok, false);
  assertIssue(result, 'E_KIND', 'meta.kind');
});
