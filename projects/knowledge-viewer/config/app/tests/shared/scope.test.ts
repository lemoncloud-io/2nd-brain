import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeFixtureVault } from '../helpers/fixture.ts';
import { gitIgnored, listDir, walkDisk, walkLint } from '../../shared/scope.ts';

let vault: ReturnType<typeof makeFixtureVault>;
let root = '';
let tmp = '';

before(() => {
  vault = makeFixtureVault();
  root = vault.root;
  tmp = path.dirname(root);
});

after(() => {
  vault.cleanup();
});

test('walkLint는 lint 범위의 md만 담는다', () => {
  const files = walkLint(root);
  for (const p of [
    'wiki/alpha.md',
    'wiki/beta.md',
    'projects/demo/README.md',
    'projects/demo/beta.md',
    'wiki/INDEX.md',
    'VAULT_RULES.md',
  ]) {
    assert.ok(files.includes(p), `${p} 가 있어야 한다`);
  }
  for (const p of ['raw/src.md', 'raw/beta.md', 'private/p.md', 'node_modules/x.md', 'dist/y.md', 'outputs/local.md']) {
    assert.ok(!files.includes(p), `${p} 는 없어야 한다`);
  }
  assert.ok(files.every((p) => p.endsWith('.md')));
});

test('walkDisk는 모든 확장자를 담고 private와 제외 폴더를 건너뛴다', () => {
  const files = walkDisk(root, { includePrivate: false });
  for (const p of ['outputs/a.html', 'raw/src.md', 'outputs/local.md']) {
    assert.ok(files.includes(p), `${p} 가 있어야 한다`);
  }
  for (const p of ['private/p.md', 'node_modules/x.md', 'dist/y.md']) {
    assert.ok(!files.includes(p), `${p} 는 없어야 한다`);
  }
  assert.deepEqual(files, [...files].sort());
});

test('includePrivate면 private를 담는다', () => {
  assert.ok(walkDisk(root, { includePrivate: true }).includes('private/p.md'));
});

test('심링크 폴더는 걷지 않는다', () => {
  fs.symlinkSync(path.join(root, 'wiki'), path.join(root, 'link'), 'dir');
  try {
    const files = walkDisk(root, { includePrivate: false });
    assert.ok(files.includes('wiki/alpha.md'));
    assert.ok(!files.some((p) => p.startsWith('link/')));
  } finally {
    fs.unlinkSync(path.join(root, 'link'));
  }
});

test('listDir는 종류와 ignored를 알려 주고 폴더를 먼저 둔다', () => {
  const entries = listDir(root, 'outputs', { includePrivate: false });
  const local = entries.find((e) => e.path === 'outputs/local.md');
  const html = entries.find((e) => e.path === 'outputs/a.html');
  assert.deepEqual(local, { name: 'local.md', path: 'outputs/local.md', kind: 'md', ignored: true });
  assert.equal(html?.kind, 'html');
  assert.equal(html?.ignored, false);

  const top = listDir(root, '', { includePrivate: false });
  const names = top.map((e) => e.name);
  assert.ok(names.includes('wiki') && names.includes('VAULT_RULES.md'));
  assert.ok(!names.includes('private') && !names.includes('node_modules') && !names.includes('dist'));
  const firstFile = top.findIndex((e) => e.kind !== 'dir');
  assert.ok(top.slice(0, firstFile).every((e) => e.kind === 'dir'));
  assert.ok(top.slice(firstFile).every((e) => e.kind !== 'dir'));
  assert.equal(top.find((e) => e.name === 'wiki')?.ignored, false);
});

test('gitIgnored는 무시되는 경로만 돌려주고, git 저장소가 아니면 빈 집합이다', () => {
  assert.deepEqual([...gitIgnored(root, ['outputs/local.md', 'wiki/alpha.md'])], ['outputs/local.md']);
  assert.equal(gitIgnored(root, []).size, 0);
  const plain = fs.mkdtempSync(path.join(tmp, 'plain-'));
  assert.equal(gitIgnored(plain, ['a.md']).size, 0);
});

test('listDir는 private 폴더를 옵션 없이 열지 않는다', () => {
  assert.throws(() => listDir(root, 'private', { includePrivate: false }), /private/);
  const names = listDir(root, 'private', { includePrivate: true }).map((e) => e.name);
  assert.deepEqual(names, ['p.md']);
});

test('listDir는 제외 폴더를 열지 않는다', () => {
  assert.throws(() => listDir(root, 'node_modules', { includePrivate: false }), /제외/);
  assert.throws(() => listDir(root, 'wiki/dist', { includePrivate: false }), /제외/);
});

test('listDir는 심링크 폴더를 열지 않는다', () => {
  fs.symlinkSync(path.join(root, 'wiki'), path.join(root, 'link'), 'dir');
  try {
    assert.throws(() => listDir(root, 'link', { includePrivate: false }), /심링크/);
  } finally {
    fs.unlinkSync(path.join(root, 'link'));
  }
});

test('listDir는 볼트 밖을 가리키는 심링크 조상도 거부한다', () => {
  const outside = fs.mkdtempSync(path.join(tmp, 'outside-'));
  fs.symlinkSync(outside, path.join(root, 'esc'), 'dir');
  try {
    assert.throws(() => listDir(root, 'esc', { includePrivate: false }));
  } finally {
    fs.unlinkSync(path.join(root, 'esc'));
  }
});

test('listDir는 끝 슬래시와 점을 정규화해 // 없는 경로를 낸다', () => {
  for (const dir of ['outputs/', './outputs', 'outputs//']) {
    const paths = listDir(root, dir, { includePrivate: false }).map((e) => e.path);
    assert.ok(paths.includes('outputs/a.html'), dir);
    assert.ok(paths.every((p) => !p.includes('//')), dir);
  }
  assert.deepEqual(listDir(root, '.', { includePrivate: false }), listDir(root, '', { includePrivate: false }));
});

test('루트의 .git 파일(워크트리)은 walkDisk와 listDir에서 빠진다', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'wt-'));
  fs.writeFileSync(path.join(dir, 'VAULT_RULES.md'), '---\ntype: concept\n---\n');
  fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /somewhere\n');
  assert.deepEqual(walkDisk(dir, { includePrivate: false }), ['VAULT_RULES.md']);
  assert.deepEqual(listDir(dir, '', { includePrivate: false }).map((e) => e.name), ['VAULT_RULES.md']);
});

test('listDir는 .. 조각을 거부한다', () => {
  assert.throws(() => listDir(root, 'wiki/../private', { includePrivate: false }), /\.\./);
  assert.throws(() => listDir(root, 'wiki/../projects', { includePrivate: false }), /\.\./);
  assert.throws(() => listDir(root, '..', { includePrivate: true }), /\.\./);
});

test('listDir는 없는 폴더에 분명한 예외를 낸다', () => {
  assert.throws(() => listDir(root, 'nope/deeper', { includePrivate: false }), { message: '폴더가 없다: nope/deeper' });
  assert.throws(() => listDir(root, 'wiki/alpha.md', { includePrivate: false }), /폴더가 아니다/);
});

test('strict: git 저장소가 아니면 walkLint가 throw 하고, 아니면 전부 담는다', () => {
  const copy = path.join(tmp, 'nogit');
  fs.cpSync(root, copy, { recursive: true });
  fs.rmSync(path.join(copy, '.git'), { recursive: true, force: true });
  assert.throws(() => walkLint(copy, { strict: true }), /git/);
  assert.ok(walkLint(copy).includes('outputs/local.md'));
  assert.ok(!walkLint(root, { strict: true }).includes('outputs/local.md'));
});
