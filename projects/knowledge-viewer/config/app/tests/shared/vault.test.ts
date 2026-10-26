import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { findVaultRoot, toVaultPath } from '../../shared/vault.ts';

const FIXTURE = path.join(import.meta.dirname, '..', 'fixtures', 'vault');

test('하위 디렉터리에서 위로 올라가며 볼트 루트를 찾는다', () => {
  assert.equal(findVaultRoot(path.join(FIXTURE, 'wiki')), fs.realpathSync(FIXTURE));
});

test('볼트 밖을 가리키는 경로는 예외다', () => {
  assert.throws(() => toVaultPath(FIXTURE, '../x'), /볼트 밖/);
});

test('절대경로는 예외다', () => {
  assert.throws(() => toVaultPath(FIXTURE, '/etc/passwd'), /절대경로/);
});

test('볼트 안 상대경로는 절대경로로 바뀐다', () => {
  assert.equal(toVaultPath(FIXTURE, 'wiki/alpha.md'), path.join(FIXTURE, 'wiki', 'alpha.md'));
});

test('..로 시작하는 이름의 파일은 허용한다', () => {
  assert.equal(toVaultPath(FIXTURE, '..foo.md'), path.join(FIXTURE, '..foo.md'));
});

test('볼트 루트 자체는 문서가 아니다', () => {
  assert.throws(() => toVaultPath(FIXTURE, ''), /루트 자체/);
  assert.throws(() => toVaultPath(FIXTURE, '.'), /루트 자체/);
});
