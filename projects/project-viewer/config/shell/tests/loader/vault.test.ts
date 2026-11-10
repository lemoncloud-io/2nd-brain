import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkProject } from '../../model/index.ts';
import { findVaultRoot, makeReadFile, toVaultPath } from '../../loader/vault.ts';

const MINI = path.join(import.meta.dirname, '..', 'fixtures', 'mini');

test('하위 디렉터리에서 위로 올라가며 볼트 루트를 찾는다', () => {
  const start = path.join(MINI, 'projects', 'demo', 'docs');
  assert.equal(findVaultRoot(start), fs.realpathSync(MINI));
});

test('루트 자신에서도 찾는다', () => {
  assert.equal(findVaultRoot(MINI), fs.realpathSync(MINI));
});

test('VAULT_RULES.md가 없으면 예외다', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'viewer-novault-'));
  try {
    assert.throws(() => findVaultRoot(dir), /VAULT_RULES\.md/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('절대경로는 예외다', () => {
  assert.throws(() => toVaultPath(MINI, '/etc/hosts'), /절대경로/);
});

test('.. 탈출은 예외다', () => {
  assert.throws(() => toVaultPath(MINI, '../밖/파일.md'), /볼트 밖/);
  assert.throws(() => toVaultPath(MINI, 'projects/../../밖.md'), /볼트 밖/);
});

test('볼트 안 상대경로는 절대경로로 바뀐다', () => {
  assert.equal(
    toVaultPath(MINI, 'projects/demo/config/viewer.yml'),
    path.join(MINI, 'projects', 'demo', 'config', 'viewer.yml'),
  );
});

test('makeReadFile은 없는 파일에 null을 준다', () => {
  const read = makeReadFile(MINI);
  assert.equal(read('projects/demo/docs/없는파일.md'), null);
  assert.ok(read('projects/demo/config/viewer.yml')!.includes('schema_version'));
});

test('makeReadFile은 디렉터리에도 null을 준다', () => {
  assert.equal(makeReadFile(MINI)('projects/demo/docs'), null);
});

test('mini fixture는 오류 0으로 통과한다 — 다음 WP의 빌드 대상이다', () => {
  const root = fs.realpathSync(MINI);
  const result = checkProject({
    viewerText: fs.readFileSync(path.join(root, 'projects/demo/config/viewer.yml'), 'utf8'),
    readFile: makeReadFile(root),
  });
  const errors = result.issues.filter((i) => i.level === 'error');
  assert.deepEqual(errors, []);
  assert.equal(result.ok, true);
  // 블록 8종을 한 번씩 쓴다.
  const types = result.viewer!.pages.flatMap((p) => p.blocks.map((b) => b.type)).sort();
  assert.deepEqual(types, ['graph', 'items', 'mermaid', 'prose', 'sequence', 'stages', 'table', 'tree']);
  assert.equal(result.status!['S1']!.origin, 'ledger');
  assert.equal(result.status!['S2']!.origin, 'ledger-default');
});
