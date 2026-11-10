import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ModelError, parseLedger } from '../../model/parse.ts';
import { matchDefault } from '../../model/rules.ts';
import { DEFAULT_FILES, assertIssue, run } from './helpers.ts';

const VIEWER = [
  'schema_version: 1',
  'meta:',
  '  title: 데모',
  '  kind: project',
  'sources:',
  '  - {id: spec, path: docs/spec.md, role: primary, kind: doc}',
  '  - {id: ledger, path: docs/status.yml, role: ledger, kind: data}',
  'pages:',
  '  - id: P1',
  '    title: 단계',
  '    blocks:',
  '      - type: stages',
  '        id: B1',
  '        evidence: [{source: spec}]',
  '        stages:',
  '          - id: S1',
  '            title: 준비',
  '            items:',
  '              - {id: S1.C1, label: 첫 점검}',
  '              - {id: S1.C2, label: 둘째 점검, required: false}',
  '          - id: S2',
  '            title: 검증',
  '',
].join('\n');

const VOCAB = [
  'schema_version: 1',
  'statuses:',
  '  passed: {label: 검증 완료, tone: green, done: true}',
  '  in_progress: {label: 진행 중, tone: blue}',
  '  not_run: {label: 미실행, tone: muted}',
].join('\n');

function ledger(tail: string[], head = VOCAB, dflt = 'default: not_run'): Record<string, string> {
  return { ...DEFAULT_FILES, 'docs/status.yml': [head, dflt, ...tail, ''].join('\n') };
}

const PASSED_S1 = [
  'stages:',
  '  S1:',
  '    status: passed',
  '    evidence: [{path: docs/spec.md, at: "검사 규칙"}]',
  'items:',
  '  S1.C1: {status: passed, evidence: [{path: docs/spec.md}]}',
];

test('규칙을 다 지킨 원장은 통과하고 상태가 채워진다', () => {
  const result = run(VIEWER, ledger(PASSED_S1));
  assert.deepEqual(result.issues, []);
  const s1 = result.status!['S1']!;
  assert.equal(s1.status, 'passed');
  assert.equal(s1.done, true);
  assert.equal(s1.tone, 'green');
  assert.equal(s1.origin, 'ledger');
  assert.equal(s1.evidence[0]!.resolved.line, 14);
  assert.equal(s1.evidence[0]!.resolved.source, 'spec');
});

test('완료 상태인데 증거가 없으면 실패한다', () => {
  const result = run(
    VIEWER,
    ledger([
      'stages:',
      '  S1: {status: passed, evidence: []}',
      'items:',
      '  S1.C1: {status: passed, evidence: [{path: docs/spec.md}]}',
    ]),
  );
  assertIssue(result, 'E_LEDGER', 'ledger.stages.S1.evidence');
});

test('기본값에 완료 상태를 쓰면 실패한다', () => {
  const result = run(VIEWER, ledger(PASSED_S1, VOCAB, 'default: passed'));
  assertIssue(result, 'E_LEDGER', 'ledger.default');
});

test('defaults의 기본값에도 완료 상태를 쓸 수 없다', () => {
  const result = run(
    VIEWER,
    ledger(['defaults:', '  - {match: "S*", status: passed}', ...PASSED_S1]),
  );
  assertIssue(result, 'E_LEDGER', 'ledger.defaults[0].status');
});

test('어휘에 없는 상태는 실패한다', () => {
  const result = run(VIEWER, ledger(['stages:', '  S1: {status: 어딘가, evidence: []}']));
  assertIssue(result, 'E_LEDGER', 'ledger.stages.S1.status');
});

test('모르는 tone은 스키마에서 실패한다', () => {
  let issues: { code: string; where: string }[] = [];
  try {
    parseLedger(
      ['schema_version: 1', 'statuses:', '  x: {label: 어떤, tone: pink}', 'default: x', ''].join('\n'),
    );
  } catch (err) {
    if (!(err instanceof ModelError)) throw err;
    issues = err.issues.map((i) => ({ code: i.code, where: i.where }));
  }
  assert.deepEqual(issues, [{ code: 'E_SCHEMA', where: 'statuses.x.tone' }]);
});

test('모르는 motion 값은 스키마에서 실패한다', () => {
  let issues: { code: string; where: string }[] = [];
  try {
    parseLedger(
      ['schema_version: 1', 'statuses:', '  x: {label: 어떤, tone: blue, motion: blink}', 'default: x', ''].join('\n'),
    );
  } catch (err) {
    if (!(err instanceof ModelError)) throw err;
    issues = err.issues.map((i) => ({ code: i.code, where: i.where }));
  }
  assert.deepEqual(issues, [{ code: 'E_SCHEMA', where: 'statuses.x.motion' }]);
});

test('motion·struck은 선언한 상태의 뷰에만 실리고, 선언하지 않은 상태의 뷰에는 키가 없다', () => {
  const head = [
    VOCAB.replace('{label: 진행 중, tone: blue}', '{label: 진행 중, tone: blue, motion: pulse}'),
    '  dropped: {label: 폐기, tone: muted, struck: true}',
  ].join('\n');
  const result = run(
    VIEWER,
    ledger(['stages:', '  S1: {status: in_progress}', '  S2: {status: dropped}'], head),
  );
  assert.deepEqual(result.issues, []);
  assert.equal(result.status!['S1']!.motion, 'pulse');
  assert.equal(result.status!['S2']!.struck, true);
  // 기본값(not_run)은 아무것도 선언하지 않았다 — 키 자체가 없어야 Bundle이 이전과 같다
  assert.deepEqual(Object.keys(result.status!['S1.C1']!).filter((k) => k === 'motion' || k === 'struck'), []);
  assert.equal('motion' in result.status!['S2']!, false);
});

test('필수 항목이 미완인데 단계가 완료면 실패한다', () => {
  const result = run(
    VIEWER,
    ledger([
      'stages:',
      '  S1:',
      '    status: passed',
      '    evidence: [{path: docs/spec.md}]',
      'items:',
      '  S1.C1: {status: in_progress}',
    ]),
  );
  assertIssue(result, 'E_LEDGER', 'ledger.stages.S1');
});

test('선택 항목이 미완인 것은 단계 완료를 막지 않는다', () => {
  const result = run(
    VIEWER,
    ledger([
      'stages:',
      '  S1:',
      '    status: passed',
      '    evidence: [{path: docs/spec.md}]',
      'items:',
      '  S1.C1: {status: passed, evidence: [{path: docs/spec.md}]}',
      '  S1.C2: {status: in_progress}',
    ]),
  );
  assert.deepEqual(result.issues, []);
});

test('원장에만 있는 id는 실패한다', () => {
  const result = run(VIEWER, ledger([...PASSED_S1, '  Z9: {status: in_progress}']));
  assertIssue(result, 'E_LEDGER', 'ledger.items.Z9');
});

test('viewer.yml에만 있는 id는 기본값을 받는다', () => {
  const result = run(VIEWER, ledger(PASSED_S1));
  const s2 = result.status!['S2']!;
  assert.equal(s2.status, 'not_run');
  assert.equal(s2.origin, 'ledger-default');
  assert.equal(s2.done, false);
  assert.equal(result.status!['S1.C2']!.origin, 'ledger-default');
});

test('defaults의 글롭이 기본값을 가른다', () => {
  const result = run(
    VIEWER,
    ledger(['defaults:', '  - {match: "S2", status: in_progress}', ...PASSED_S1]),
  );
  assert.equal(result.status!['S2']!.status, 'in_progress');
  assert.equal(result.status!['S2']!.origin, 'ledger-default');
});

test('matchDefault는 *만 글롭으로 본다', () => {
  const rules = [{ match: 'S1.*', status: 'a' }, { match: '*', status: 'b' }];
  assert.equal(matchDefault('S1.C1', rules), 'a');
  assert.equal(matchDefault('S2', rules), 'b');
  assert.equal(matchDefault('S1?C1', [{ match: 'S1?C1', status: 'c' }]), 'c');
  assert.equal(matchDefault('S1xC1', [{ match: 'S1?C1', status: 'c' }]), null);
});

test('증거가 가리키는 파일이 없으면 실패한다', () => {
  const result = run(
    VIEWER,
    ledger([
      'stages:',
      '  S1:',
      '    status: passed',
      '    evidence: [{path: docs/gone.md}]',
      'items:',
      '  S1.C1: {status: passed, evidence: [{path: docs/spec.md}]}',
    ]),
  );
  assertIssue(result, 'E_LEDGER', 'ledger.stages.S1.evidence[0]');
});

test('증거의 앵커가 해소되지 않으면 실패한다', () => {
  const result = run(
    VIEWER,
    ledger([
      'stages:',
      '  S1:',
      '    status: passed',
      '    evidence: [{path: docs/spec.md, at: "없는 절"}]',
      'items:',
      '  S1.C1: {status: passed, evidence: [{path: docs/spec.md}]}',
    ]),
  );
  assertIssue(result, 'E_REF_UNRESOLVED', 'ledger.stages.S1.evidence[0]');
});

const WITH_STATUS_FROM = VIEWER.replace(
  '          - id: S2\n            title: 검증',
  '          - id: S2\n            title: 검증\n            status_from: {source: spec}',
);

test('status_from의 frontmatter 값이 어휘에 없으면 실패한다', () => {
  const noInProgress = [
    'schema_version: 1',
    'statuses:',
    '  passed: {label: 검증 완료, tone: green, done: true}',
    '  not_run: {label: 미실행, tone: muted}',
  ].join('\n');
  const result = run(WITH_STATUS_FROM, ledger(PASSED_S1, noInProgress));
  assertIssue(result, 'E_LEDGER', 'pages[0].blocks[0].stages[1].status_from');
});

test('status_from의 값이 어휘에 있으면 origin이 frontmatter다', () => {
  const result = run(WITH_STATUS_FROM, ledger(PASSED_S1));
  assert.deepEqual(result.issues, []);
  const s2 = result.status!['S2']!;
  assert.equal(s2.status, 'in_progress');
  assert.equal(s2.origin, 'frontmatter');
  assert.equal(s2.label, '진행 중');
});

test('원장도 status_from도 없는 단계는 origin이 none이다', () => {
  const noLedger = VIEWER.replace(
    '  - {id: ledger, path: docs/status.yml, role: ledger, kind: data}\n',
    '',
  );
  const result = run(noLedger);
  assert.deepEqual(result.issues, []);
  const s1 = result.status!['S1']!;
  assert.equal(s1.status, null);
  assert.equal(s1.origin, 'none');
  assert.equal(s1.label, '상태 근거 미등록');
  assert.equal(s1.tone, 'muted');
  assert.equal(s1.done, false);
});

test('원장이 없으면 viewer.yml의 statuses가 status_from의 어휘가 된다', () => {
  const noLedger = VIEWER.replace(
    '  - {id: ledger, path: docs/status.yml, role: ledger, kind: data}\n',
    '',
  ).replace(
    'pages:',
    ['statuses:', '  in_progress: {label: 진행 중, tone: blue}', 'pages:'].join('\n'),
  ).replace(
    '          - id: S2\n            title: 검증',
    '          - id: S2\n            title: 검증\n            status_from: {source: spec}',
  );
  const result = run(noLedger);
  assert.deepEqual(result.issues, []);
  assert.equal(result.status!['S2']!.origin, 'frontmatter');
  assert.equal(result.status!['S2']!.tone, 'blue');
});
