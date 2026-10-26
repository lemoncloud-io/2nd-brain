// /api/info — 볼트 이름·브랜치·워크트리 여부. 절대경로는 안 나간다.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { vaultInfo } from '../../server/info.ts';
import { makeFixtureVault } from '../helpers/fixture.ts';

let fx: { root: string; cleanup(): void };
before(() => {
  fx = makeFixtureVault();
  spawnSync('git', ['-C', fx.root, '-c', 'user.email=t@e.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init'], { encoding: 'utf8' });
});
after(() => fx.cleanup());

test('vaultInfo: 이름·브랜치·head 가 있고 절대경로는 없다', () => {
  const info = vaultInfo(fx.root);
  assert.equal(info.name, path.basename(fx.root));
  assert.equal(typeof info.branch, 'string');
  assert.match(info.head ?? '', /^[0-9a-f]{7,}$/);
  assert.equal(info.worktree, false);
  assert.equal(info.dirty, false);
  assert.equal(JSON.stringify(info).includes(fx.root), false);
});

test('vaultInfo: 추적 파일을 고치면 dirty', () => {
  fs.appendFileSync(path.join(fx.root, 'wiki/beta.md'), '\n바뀜\n');
  assert.equal(vaultInfo(fx.root).dirty, true);
});

test('vaultInfo: git 저장소가 아니면 null 값', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kv-nogit-'));
  try {
    const info = vaultInfo(dir);
    assert.equal(info.branch, null);
    assert.equal(info.head, null);
    assert.equal(info.worktree, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
