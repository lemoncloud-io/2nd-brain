// 스탬프는 전부 자동이다. git과 시계는 주입받으므로 테스트에서 실제 git을 부르지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { digest12, makeStamp, readGit } from '../../loader/stamp.ts';

const AT = (): Date => new Date('2026-09-19T01:02:03.000Z');

const COUNTS = { unresolvedLinks: 2, missingReferences: 1, unverifiedCode: 3, inheritedEvidence: 4 };

test('makeStamp은 주입받은 시계와 git을 그대로 옮긴다', () => {
  const stamp = makeStamp({
    now: AT,
    git: { commit: 'abcd1234', dirty: false },
    docCount: 4,
    ymlDigest: 'aaaaaaaaaaaa',
    ledgerDigest: 'bbbbbbbbbbbb',
    counts: COUNTS,
  });
  assert.equal(stamp.builtAt, '2026-09-19T01:02:03.000Z');
  assert.equal(stamp.commit, 'abcd1234');
  assert.equal(stamp.dirty, false);
  assert.equal(stamp.docCount, 4);
  assert.equal(stamp.ledgerDigest, 'bbbbbbbbbbbb');
  assert.deepEqual(stamp.counts, COUNTS);
});

test('dirty가 스탬프에 그대로 남는다', () => {
  const stamp = makeStamp({
    now: AT,
    git: { commit: 'abcd1234', dirty: true },
    docCount: 1,
    ymlDigest: 'aaaaaaaaaaaa',
    ledgerDigest: null,
    counts: COUNTS,
  });
  assert.equal(stamp.dirty, true);
  assert.equal(stamp.ledgerDigest, null);
});

test('경고 수를 집계해 담는다', () => {
  const stamp = makeStamp({
    now: AT,
    git: { commit: null, dirty: false },
    docCount: 0,
    ymlDigest: '',
    ledgerDigest: null,
    counts: { unresolvedLinks: 0, missingReferences: 0, unverifiedCode: 0, inheritedEvidence: 0 },
  });
  assert.deepEqual(stamp.counts, {
    unresolvedLinks: 0,
    missingReferences: 0,
    unverifiedCode: 0,
    inheritedEvidence: 0,
  });
});

test('readGit은 커밋을 8자로 읽고 변경이 있으면 dirty다', () => {
  const calls: string[][] = [];
  const info = readGit('/없어도-된다', {
    run: (args) => {
      calls.push(args);
      if (args[0] === 'rev-parse') return 'abcd1234\n';
      return ' M projects/demo/docs/flow.md\n';
    },
  });
  assert.deepEqual(info, { commit: 'abcd1234', dirty: true });
  assert.deepEqual(calls[0], ['rev-parse', '--short=8', 'HEAD']);
  assert.equal(calls[1]![0], 'status');
  assert.equal(calls[1]![1], '--porcelain');
});

test('변경이 없으면 dirty가 아니다', () => {
  const info = readGit('/없어도-된다', {
    run: (args) => (args[0] === 'rev-parse' ? 'abcd1234\n' : '\n'),
  });
  assert.deepEqual(info, { commit: 'abcd1234', dirty: false });
});

test('관련 경로를 주면 status 인자에 붙는다', () => {
  const calls: string[][] = [];
  readGit('/없어도-된다', {
    paths: ['projects/demo/config/viewer.yml', 'projects/demo/docs/flow.md'],
    run: (args) => {
      calls.push(args);
      return '';
    },
  });
  assert.deepEqual(calls[1], [
    'status',
    '--porcelain',
    '--',
    'projects/demo/config/viewer.yml',
    'projects/demo/docs/flow.md',
  ]);
});

test('git이 없거나 실패하면 commit은 null이고 dirty는 false다', () => {
  const info = readGit('/없어도-된다', {
    run: () => {
      throw new Error('spawn git ENOENT');
    },
  });
  assert.deepEqual(info, { commit: null, dirty: false });
});

test('rev-parse만 실패해도 조용히 null이 된다', () => {
  const info = readGit('/없어도-된다', {
    run: (args) => {
      if (args[0] === 'rev-parse') throw new Error('not a git repository');
      return ' M x\n';
    },
  });
  assert.deepEqual(info, { commit: null, dirty: false });
});

test('지문은 sha256 앞 12자다', () => {
  const d = digest12('abc');
  assert.equal(d.length, 12);
  // sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
  assert.equal(d, 'ba7816bf8f01');
});

// 회귀: 플러그인이 저장소 전체로 dirty를 판정해, 뷰어와 무관한 변경(빌드 산출물 자신 포함)만 있어도
// HTML에 dirty가 찍혔다. CLI 요약과 HTML의 스탬프가 서로 달랐다(G3에서 실측).
test('프로젝트의 git 판정은 yml과 볼트 안 원본 경로만 본다', async () => {
  const { readProjectGit } = await import('../../loader/collect.ts');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const projectDir = path.resolve(here, '..', 'fixtures', 'mini', 'projects', 'demo');
  const calls: string[][] = [];
  const git = readProjectGit(projectDir, (args) => {
    calls.push(args);
    return args[0] === 'rev-parse' ? 'abcdef12\n' : '';
  });
  assert.deepEqual(git, { commit: 'abcdef12', dirty: false });
  const status = calls.find((a) => a[0] === 'status');
  assert.ok(status, 'status를 호출해야 한다');
  assert.equal(status[2], '--', '경로를 한정해야 한다 — 저장소 전체를 보면 안 된다');
  const paths = status.slice(3);
  assert.ok(paths.includes('projects/demo/config/viewer.yml'));
  assert.ok(paths.includes('projects/demo/docs/status.yml'), '원장도 원본이다');
  assert.ok(paths.every((p) => !path.isAbsolute(p)), '볼트 상대경로여야 한다');
  assert.ok(paths.every((p) => !p.includes('outputs/viewer')), '산출물은 판정 대상이 아니다');
});
