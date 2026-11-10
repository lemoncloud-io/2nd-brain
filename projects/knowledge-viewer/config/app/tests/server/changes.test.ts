// PR 변경 목록과 문서 hunk. 디프 기준은 base 와 PR 머리의 merge-base 다 — 스택 PR 은 제 커밋만 보인다.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';

import { docChange, parseHunks, parseNameStatus, prChanges, type PrChanges } from '../../server/changes.ts';
import { git } from '../../server/git.ts';
import { createViewerServer } from '../../server/main.ts';
import type { GhRunner } from '../../server/panels/prs.ts';
import { SourceManager } from '../../server/source.ts';
import { makeGitFixture, type GitFixture } from '../helpers/git-fixture.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const NEW_MD = '# 새 문서\n\nPR 이 더한 문서다.\n';

/**
 * master 의 alpha.md 에서 8번째 줄을 바꾸고, 16~18번째 줄(코드 펜스 세 줄)을 지우고, 끝에 두 줄을 더한다.
 * 새 파일 기준: 바뀐 줄 8, 지운 자리 15 뒤(3줄), 더한 줄 22~23.
 */
function prAlpha(master: string): string {
  const lines = master.split('\n');
  assert.equal(lines[15], '```');
  assert.equal(lines[17], '```');
  lines[7] = '링크: [[beta]] 와 [[new]] 를 본다.';
  lines.splice(15, 3);
  // 끝은 '' (마지막 줄바꿈)다. 그 앞에 두 줄을 넣는다.
  lines.splice(lines.length - 1, 0, '추가 줄 하나', '추가 줄 둘');
  return lines.join('\n');
}

function isChanges(c: PrChanges | { error: string }): c is PrChanges {
  return !('error' in c);
}

async function changesOf(mgr: SourceManager, root: string, n: number): Promise<PrChanges> {
  const c = await prChanges(mgr, root, n);
  if (!isChanges(c)) throw new Error(`prChanges 실패: ${c.error}`);
  return c;
}

function runGit(root: string, args: string[]): string {
  const res = spawnSync(
    'git',
    ['-C', root, '-c', 'user.email=test@example.com', '-c', 'user.name=test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } },
  );
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} 실패: ${res.stderr}`);
  return res.stdout.trim();
}

describe('parseHunks', () => {
  it('-U0 hunk 머리를 줄 범위·지운 자리·줄 수로 푼다', () => {
    const r = parseHunks('@@ -8,0 +9 @@ x\n@@ -39,0 +41,7 @@\n@@ -12,3 +12,0 @@');
    assert.deepEqual(r.hunks, [
      { start: 9, end: 9 },
      { start: 41, end: 47 },
    ]);
    assert.deepEqual(r.removed, [{ afterLine: 12, count: 3 }]);
    assert.equal(r.added, 8);
    assert.equal(r.deleted, 3);
  });

  it('파일 머리·본문 줄·"\\ No newline" 줄·꼬리 문맥을 견딘다', () => {
    const out = [
      'diff --git a/wiki/a.md b/wiki/a.md',
      'index 1111111..2222222 100644',
      '--- a/wiki/a.md',
      '+++ b/wiki/a.md',
      '@@ -3 +3 @@ ## 절 제목 @@ 안의 골뱅이',
      '-옛 줄',
      '+새 줄',
      '@@ -10,2 +9,0 @@',
      '-@@ -1 +1 @@ 처럼 생긴 지운 줄',
      '-둘',
      '\\ No newline at end of file',
      '@@ -20,0 +18,2 @@',
      '+@@ -5,5 +5,5 @@ 처럼 생긴 더한 줄',
      '+둘',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    const r = parseHunks(out);
    assert.deepEqual(r.hunks, [
      { start: 3, end: 3 },
      { start: 18, end: 19 },
    ]);
    assert.deepEqual(r.removed, [{ afterLine: 9, count: 2 }]);
    assert.equal(r.added, 3);
    assert.equal(r.deleted, 3);
  });

  it('빈 출력은 빈 결과다', () => {
    assert.deepEqual(parseHunks(''), { hunks: [], removed: [], added: 0, deleted: 0 });
  });
});

describe('parseNameStatus', () => {
  it('-z 형식의 A·M·D·R100 을 푼다', () => {
    const out = ['A', 'wiki/new.md', 'M', 'wiki/alpha.md', 'D', 'wiki/gone.md', 'R100', 'wiki/old name.md', 'wiki/새 이름.md', ''].join('\0');
    assert.deepEqual(parseNameStatus(out), [
      { path: 'wiki/new.md', status: 'A' },
      { path: 'wiki/alpha.md', status: 'M' },
      { path: 'wiki/gone.md', status: 'D' },
      { path: 'wiki/새 이름.md', status: 'R', from: 'wiki/old name.md' },
    ]);
  });

  it('R 점수가 100 이 아니어도 R 이고, C 는 두 경로를 먹고 새 경로를 M 으로, T 는 M 이다', () => {
    const out = ['R087', 'a.md', 'b.md', 'C075', 'c.md', 'd.md', 'T', 'e.md', 'M', 'f.md', ''].join('\0');
    assert.deepEqual(parseNameStatus(out), [
      { path: 'b.md', status: 'R', from: 'a.md' },
      { path: 'd.md', status: 'M' },
      { path: 'e.md', status: 'M' },
      { path: 'f.md', status: 'M' },
    ]);
  });

  it('빈 출력은 빈 목록이다', () => {
    assert.deepEqual(parseNameStatus(''), []);
  });
});

describe('prChanges·docChange (git 픽스처)', () => {
  let fx: GitFixture;
  let gh: GhRunner;
  let mgr: SourceManager;
  let masterAlpha: string;
  let betaPr2: string;
  let pr3Head: string;
  let forkPoint: string;

  before(() => {
    fx = makeGitFixture();
    masterAlpha = fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'vault', 'wiki', 'alpha.md'), 'utf8');
    forkPoint = runGit(fx.root, ['rev-parse', 'master']);
    fx.openPr(1, 'master', { 'wiki/alpha.md': prAlpha(masterAlpha), 'wiki/new.md': NEW_MD }, 'PR 1');
    // PR 1 을 연 뒤 master 가 앞서 나간다 — base 끝과 두 점 디프를 뜨면 INDEX.md 가 섞인다.
    fx.commitOnMaster({ 'wiki/INDEX.md': `${fs.readFileSync(path.join(fx.root, 'wiki', 'INDEX.md'), 'utf8')}\nmaster 가 나중에 더한 줄\n` }, 'master 진행');
    // 스택 PR: PR 2 는 PR 1 의 브랜치 위에서 beta.md 한 줄만 고친다.
    const beta = fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'vault', 'wiki', 'beta.md'), 'utf8');
    betaPr2 = beta.replace('본문이다.', 'PR 2 가 고친 본문이다.');
    assert.notEqual(betaPr2, beta);
    fx.openPr(2, 'pr-1', { 'wiki/beta.md': betaPr2 }, 'PR 2');
    // PR 3: beta.md 를 gamma.md 로 옮기며 한 줄 고친다(이름 바꾸기).
    runGit(fx.root, ['checkout', '-q', '-f', '-B', 'pr-3', 'master']);
    runGit(fx.root, ['mv', 'wiki/beta.md', 'wiki/gamma.md']);
    fs.writeFileSync(path.join(fx.root, 'wiki', 'gamma.md'), beta.replace('둘째 절이다.', '옮기며 고친 둘째 절이다.'));
    runGit(fx.root, ['add', '-A', 'wiki']);
    runGit(fx.root, ['commit', '-q', '-m', 'PR 3']);
    runGit(fx.root, ['push', '-q', '-f', 'origin', 'pr-3:refs/heads/pr-3', 'pr-3:refs/pull/3/head']);
    pr3Head = runGit(fx.root, ['rev-parse', 'HEAD']);
    runGit(fx.root, ['checkout', '-q', '-f', 'master']);
    gh = async (args, cwd) => {
      if (args[0] === 'pr' && args[1] === 'view' && args[2] === '3') {
        const meta = {
          number: 3,
          title: 'PR 3',
          author: { login: 't' },
          headRefName: 'pr-3',
          baseRefName: 'master',
          headRefOid: pr3Head,
          updatedAt: '2026-10-23T00:00:00Z',
          url: 'https://example.test/pull/3',
        };
        return { stdout: JSON.stringify(meta), stderr: '', status: 0 };
      }
      return fx.gh(args, cwd);
    };
    mgr = new SourceManager(fx.root, { gh });
  });
  after(() => fx.cleanup());

  it('PR 1 의 변경 목록은 M wiki/alpha.md·A wiki/new.md 이고 PR 메타를 담는다', async () => {
    const c = await changesOf(mgr, fx.root, 1);
    assert.deepEqual(
      [...c.files].sort((a, b) => a.path.localeCompare(b.path)),
      [
        { path: 'wiki/alpha.md', status: 'M' },
        { path: 'wiki/new.md', status: 'A' },
      ],
    );
    assert.equal(c.number, 1);
    assert.equal(c.base, 'master');
    assert.equal(c.head, 'pr-1');
    assert.match(c.mergeBase, /^[0-9a-f]{40}$/);
    assert.match(c.baseOid, /^[0-9a-f]{40}$/);
    // merge-base 는 PR 1 이 갈라진 커밋이고, master 끝(baseOid)은 그보다 앞서 있다.
    assert.equal(c.mergeBase, forkPoint);
    assert.equal(c.baseOid, runGit(fx.root, ['rev-parse', 'master']));
    assert.notEqual(c.baseOid, c.mergeBase);
  });

  it('스택 PR 2(base = pr-1)는 제 커밋의 wiki/beta.md 하나만 보인다', async () => {
    const c = await changesOf(mgr, fx.root, 2);
    assert.deepEqual(c.files, [{ path: 'wiki/beta.md', status: 'M' }]);
    assert.equal(c.base, 'pr-1');
    // merge-base 는 PR 1 의 머리다(master 가 아니다).
    assert.equal(c.mergeBase, runGit(fx.root, ['rev-parse', 'refs/kv/pr/1']));
    assert.equal(c.baseOid, c.mergeBase);
  });

  it('이름 바꾸기는 R 이고 from 이 옛 경로다', async () => {
    const c = await changesOf(mgr, fx.root, 3);
    assert.deepEqual(c.files, [{ path: 'wiki/gamma.md', status: 'R', from: 'wiki/beta.md' }]);
    const d = docChange(fx.root, c, 'wiki/gamma.md');
    assert.equal(d.status, 'R');
    // 옮기며 고친 한 줄(11번째)만 hunk 다 — 파일 전체가 '더함'으로 보이면 안 된다.
    assert.deepEqual(d.hunks, [{ start: 11, end: 11 }]);
    assert.equal(d.added, 1);
    assert.equal(d.deleted, 1);
  });

  it('docChange 는 바꾼 줄·지운 자리·더한 줄을 파일 전체 줄 번호로 가리킨다', async () => {
    const c = await changesOf(mgr, fx.root, 1);
    const d = docChange(fx.root, c, 'wiki/alpha.md');
    assert.equal(d.status, 'M');
    assert.deepEqual(d.hunks, [
      { start: 8, end: 8 },
      { start: 22, end: 23 },
    ]);
    assert.deepEqual(d.removed, [{ afterLine: 15, count: 3 }]);
    assert.equal(d.added, 3);
    assert.equal(d.deleted, 4);
  });

  it('docChange 의 diff 는 --inter-hunk-context=0 을 건넨다', async () => {
    const c = await changesOf(mgr, fx.root, 1);
    const seen: string[][] = [];
    const spy: typeof git = (root, args, o) => {
      seen.push(args);
      return git(root, args, o);
    };
    docChange(fx.root, c, 'wiki/alpha.md', { git: spy });
    const diffCall = seen.find((a) => a.includes('-U0'));
    assert.ok(diffCall !== undefined);
    assert.ok(diffCall.includes('--inter-hunk-context=0'));
  });

  it('더한 문서는 A 이고 전체가 hunk 다', async () => {
    const c = await changesOf(mgr, fx.root, 1);
    assert.deepEqual(docChange(fx.root, c, 'wiki/new.md'), {
      status: 'A',
      hunks: [{ start: 1, end: 3 }],
      removed: [],
      added: 3,
      deleted: 0,
    });
  });

  it('목록에 없는 문서는 status null·빈 hunk 이고 git 을 부르지 않는다', async () => {
    const c = await changesOf(mgr, fx.root, 1);
    assert.deepEqual(docChange(fx.root, c, 'wiki/beta.md'), { status: null, hunks: [], removed: [], added: 0, deleted: 0 });
    assert.deepEqual(docChange('/nonexistent-root', c, 'wiki/beta.md'), { status: null, hunks: [], removed: [], added: 0, deleted: 0 });
  });

  it('지운 문서는 D·빈 hunk 다', async () => {
    const c = await changesOf(mgr, fx.root, 1);
    const gone: PrChanges = { ...c, files: [...c.files, { path: 'wiki/gone.md', status: 'D' }] };
    assert.deepEqual(docChange(fx.root, gone, 'wiki/gone.md'), { status: 'D', hunks: [], removed: [], added: 0, deleted: 0 });
  });

  it('모르는 PR 은 {error}', async () => {
    const c = await prChanges(mgr, fx.root, 99);
    assert.ok('error' in c);
    assert.notEqual((c as { error: string }).error, '');
  });

  it('60초 안에 머리가 같으면 merge-base·diff 를 다시 돌리지 않는다', async () => {
    let t = 1_000_000;
    const now = (): number => t;
    const calls: string[] = [];
    const spy: typeof git = (root, args, o) => {
      if (args.includes('merge-base')) calls.push('merge-base');
      if (args.includes('diff')) calls.push('diff');
      return git(root, args, o);
    };
    const m = new SourceManager(fx.root, { gh, now });
    const a = await prChanges(m, fx.root, 1, { git: spy, now });
    const b = await prChanges(m, fx.root, 1, { git: spy, now });
    assert.ok(isChanges(a) && isChanges(b));
    assert.deepEqual(calls, ['merge-base', 'diff']);
    assert.deepEqual(a, b);
    t += 61_000;
    await prChanges(m, fx.root, 1, { git: spy, now });
    assert.deepEqual(calls, ['merge-base', 'diff', 'merge-base', 'diff']);
    // 다른 관리자의 캐시는 섞이지 않는다.
    await prChanges(new SourceManager(fx.root, { gh, now }), fx.root, 1, { git: spy, now });
    assert.equal(calls.length, 6);
  });

  it('merge-base·diff 실패 사유도 절대경로·file:// 를 가린다', async () => {
    const m = new SourceManager(fx.root, { gh });
    const failOn = (cmd: string, stderr: string): typeof git => (root, args, o) =>
      args.includes(cmd) ? { ok: false, stdout: '', stderr } : git(root, args, o);
    const mb = await prChanges(m, fx.root, 1, { git: failOn('merge-base', "fatal: cannot open '/Users/someone/v/.git/objects': denied\nmore") });
    assert.ok('error' in mb);
    assert.equal(mb.error, "merge-base 실패: fatal: cannot open '<path>': denied");
    const df = await prChanges(m, fx.root, 1, { git: failOn('diff', 'fatal: bad object in file:///private/tmp/kv/origin.git, giving up') });
    assert.ok('error' in df);
    assert.equal(df.error, 'diff 실패: fatal: bad object in <path>, giving up');
  });
});

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

describe('HTTP 서버 — PR 변경', () => {
  let fx: GitFixture;
  let distTmp: string;
  let server: http.Server;
  let base: string;

  before(async () => {
    fx = makeGitFixture();
    const masterAlpha = fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'vault', 'wiki', 'alpha.md'), 'utf8');
    fx.openPr(1, 'master', { 'wiki/alpha.md': prAlpha(masterAlpha), 'wiki/new.md': NEW_MD }, 'PR 1');
    distTmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kv-dist-'));
    server = createViewerServer({
      root: fx.root,
      includePrivate: false,
      distDir: path.join(distTmp, 'dist'),
      watch: false,
      gh: fx.gh,
      sources: new SourceManager(fx.root, { gh: fx.gh }),
      log: () => {},
    });
    base = await listen(server);
  });
  after(async () => {
    await close(server);
    fx.cleanup();
    fs.rmSync(distTmp, { recursive: true, force: true });
  });

  const get = async (p: string): Promise<{ status: number; json: Json }> => {
    const res = await fetch(base + p);
    return { status: res.status, json: (await res.json()) as Json };
  };

  it('/api/pr/1/changes 는 200 과 변경 목록', async () => {
    const { status, json } = await get('/api/pr/1/changes');
    assert.equal(status, 200);
    assert.equal(json.number, 1);
    assert.equal(json.title, 'PR 1');
    assert.match(json.mergeBase, /^[0-9a-f]{40}$/);
    assert.deepEqual(
      (json.files as Json[]).map((f) => `${f.status} ${f.path}`).sort(),
      ['A wiki/new.md', 'M wiki/alpha.md'],
    );
  });

  it('번호가 아니거나 10자리 이상이면 404, 모르는 PR 은 503', async () => {
    for (const p of ['/api/pr/abc/changes', '/api/pr/1234567890/changes', '/api/pr//changes', '/api/pr/-1/changes', '/api/pr/1/changes/x', '/api/pr/1']) {
      assert.equal((await get(p)).status, 404, p);
    }
    const unknown = await get('/api/pr/99/changes');
    assert.equal(unknown.status, 503);
    assert.equal(typeof unknown.json.error, 'string');
  });

  it('/api/doc?src=pr:1 에 change 가 붙는다', async () => {
    const { status, json } = await get('/api/doc?path=wiki/alpha.md&src=pr:1');
    assert.equal(status, 200);
    assert.equal(json.change.status, 'M');
    assert.ok((json.change.hunks as Json[]).length > 0);
    assert.deepEqual(json.change.hunks, [
      { start: 8, end: 8 },
      { start: 22, end: 23 },
    ]);
    assert.deepEqual(json.change.removed, [{ afterLine: 15, count: 3 }]);
    const untouched = await get('/api/doc?path=wiki/beta.md&src=pr:1');
    assert.equal(untouched.status, 200);
    assert.equal(untouched.json.change.status, null);
  });

  it('src=main·local 응답엔 change 가 없다', async () => {
    for (const q of ['&src=main', '&src=local', '']) {
      const { status, json } = await get(`/api/doc?path=wiki/alpha.md${q}`);
      assert.equal(status, 200, q);
      assert.equal('change' in json, false, q);
    }
  });

  // 마지막에 둔다: base ref 를 지워 이 서버의 PR 1 변경 목록을 깨뜨린다(리더는 ttl 안이라 다시 받지 않는다).
  it('변경 목록을 못 뜨면 문서는 200, change 대신 changeError', async () => {
    assert.equal((await get('/api/doc?path=wiki/alpha.md&src=pr:1')).status, 200);
    const del = spawnSync('git', ['update-ref', '-d', 'refs/kv/base/master'], { cwd: fx.root });
    assert.equal(del.status, 0);
    const { status, json } = await get('/api/doc?path=wiki/alpha.md&src=pr:1');
    assert.equal(status, 200);
    assert.equal('change' in json, false);
    assert.equal(typeof json.changeError, 'string');
    assert.match(json.changeError, /refs\/kv\/base\/master/);
    assert.doesNotMatch(json.changeError, /\/Users\/|\/private\//);
  });
});

describe('머지된 PR — 머지 커밋^1..머지 커밋 (git 픽스처)', () => {
  let fx: GitFixture;
  let masterAlpha: string;
  let pr4: { headOid: string };
  let merge4: string;
  let squash5: string;
  let afterMerge: string;
  let strayOid: string;
  /** 번호 → gh 가 덧붙일 state·mergeCommit. 시험이 바꾼다. */
  const extra = new Map<number, Record<string, unknown>>();
  let gh: GhRunner;

  before(() => {
    fx = makeGitFixture();
    masterAlpha = fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'vault', 'wiki', 'alpha.md'), 'utf8');
    // PR 4: 참 머지. 연 뒤 master 가 앞서 나가고(INDEX.md), 그 위에 --no-ff 로 머지한다.
    pr4 = fx.openPr(4, 'master', { 'wiki/alpha.md': prAlpha(masterAlpha), 'wiki/new.md': NEW_MD }, 'PR 4');
    fx.commitOnMaster({ 'wiki/INDEX.md': `${fs.readFileSync(path.join(fx.root, 'wiki', 'INDEX.md'), 'utf8')}\nmaster 가 나중에 더한 줄\n` }, 'master 진행');
    runGit(fx.root, ['checkout', '-q', '-f', 'master']);
    runGit(fx.root, ['merge', '-q', '--no-ff', '-m', 'Merge PR 4', 'pr-4']);
    merge4 = runGit(fx.root, ['rev-parse', 'HEAD']);
    // PR 5: 스쿼시 머지. beta.md 한 줄.
    const beta = fs.readFileSync(path.join(fx.root, 'wiki', 'beta.md'), 'utf8');
    fx.openPr(5, 'master', { 'wiki/beta.md': beta.replace('본문이다.', 'PR 5 가 고친 본문이다.') }, 'PR 5');
    runGit(fx.root, ['checkout', '-q', '-f', 'master']);
    runGit(fx.root, ['merge', '-q', '--squash', 'pr-5']);
    runGit(fx.root, ['commit', '-q', '-m', 'PR 5 (#5)']);
    squash5 = runGit(fx.root, ['rev-parse', 'HEAD']);
    runGit(fx.root, ['push', '-q', 'origin', 'master']);
    // 머지 뒤에도 master 가 나아간다 — base 끝이 머지 커밋이 아니어도 범위는 머지 커밋 기준이다.
    afterMerge = fx.commitOnMaster({ 'wiki/later.md': '# 나중\n' }, '머지 뒤 진행');
    // PR 6: 열린 채로 둔다. 그 머리는 master 에 없다 — base 에 닿지 않는 oid 로 쓴다.
    strayOid = fx.openPr(6, 'master', { 'wiki/stray.md': '# 떠돌이\n' }, 'PR 6').headOid;
    gh = async (args, cwd) => {
      const r = await fx.gh(args, cwd);
      const more = extra.get(Number(args[2]));
      if (r.status !== 0 || more === undefined) return r;
      return { ...r, stdout: JSON.stringify({ ...JSON.parse(r.stdout), ...more }) };
    };
  });
  after(() => fx.cleanup());

  it('gh 응답에 state 가 없으면 OPEN 이고 mergeCommit·note 가 없다', async () => {
    const c = await changesOf(new SourceManager(fx.root, { gh: fx.gh }), fx.root, 6);
    assert.equal(c.state, 'OPEN');
    assert.equal('mergeCommit' in c, false);
    assert.equal('note' in c, false);
    assert.deepEqual(c.files, [{ path: 'wiki/stray.md', status: 'A' }]);
  });

  it('참 머지: 범위는 머지 커밋^1..머지 커밋, 읽는 커밋·headCommit 은 머지 커밋, headOid 는 gh 머리', async () => {
    extra.set(4, { state: 'MERGED', mergeCommit: { oid: merge4 } });
    const mgr = new SourceManager(fx.root, { gh });
    const seen: string[][] = [];
    const spy: typeof git = (root, args, o) => {
      seen.push(args);
      return git(root, args, o);
    };
    const c = await prChanges(mgr, fx.root, 4, { git: spy });
    assert.ok(isChanges(c));
    assert.equal(c.state, 'MERGED');
    assert.equal(c.mergeCommit, merge4);
    assert.equal(c.headCommit, merge4);
    assert.equal(c.headOid, pr4.headOid);
    assert.equal(c.mergeBase, runGit(fx.root, ['rev-parse', `${merge4}^1`]));
    assert.equal(c.baseOid, afterMerge);
    assert.equal('note' in c, false);
    // master 진행(INDEX.md)·머지 뒤 진행(later.md)은 섞이지 않는다.
    assert.deepEqual(
      [...c.files].sort((a, b) => a.path.localeCompare(b.path)),
      [
        { path: 'wiki/alpha.md', status: 'M' },
        { path: 'wiki/new.md', status: 'A' },
      ],
    );
    assert.equal(seen.some((a) => a[0] === 'merge-base'), false);
    assert.ok(seen.some((a) => a.includes('--name-status') && a.includes(`${c.mergeBase}..${merge4}`)));
    // 리더도 머지 커밋을 읽는다 — 내용과 변경 막대가 같은 커밋이다.
    const reader = await mgr.reader({ kind: 'pr', number: 4 }, false);
    assert.ok(!('error' in reader));
    assert.equal(reader.commit, merge4);
    assert.equal(reader.readText('wiki/alpha.md'), prAlpha(masterAlpha));
    assert.equal(reader.exists('wiki/later.md'), false);
    const d = docChange(fx.root, c, 'wiki/alpha.md');
    assert.equal(d.status, 'M');
    assert.deepEqual(d.hunks, [
      { start: 8, end: 8 },
      { start: 22, end: 23 },
    ]);
    assert.deepEqual(d.removed, [{ afterLine: 15, count: 3 }]);
    await mgr.idle();
  });

  it('스쿼시 머지: 머지 커밋 하나의 부모와 비교한다', async () => {
    extra.set(5, { state: 'MERGED', mergeCommit: { oid: squash5 } });
    const mgr = new SourceManager(fx.root, { gh });
    const c = await changesOf(mgr, fx.root, 5);
    assert.equal(c.headCommit, squash5);
    assert.equal(c.mergeBase, merge4);
    assert.deepEqual(c.files, [{ path: 'wiki/beta.md', status: 'M' }]);
    await mgr.idle();
  });

  it('닫힌(머지 안 된) PR 은 열린 PR 과 같다 — merge-base..머리', async () => {
    extra.set(6, { state: 'CLOSED', mergeCommit: null });
    const mgr = new SourceManager(fx.root, { gh });
    const c = await changesOf(mgr, fx.root, 6);
    assert.equal(c.state, 'CLOSED');
    assert.equal(c.headCommit, strayOid);
    assert.equal('mergeCommit' in c, false);
    assert.deepEqual(c.files, [{ path: 'wiki/stray.md', status: 'A' }]);
    extra.delete(6);
    await mgr.idle();
  });

  it('머지 커밋이 없거나 base 에 닿지 않으면 옛 방식(merge-base..PR 머리)과 note, 오류 없음', async () => {
    for (const oid of ['f'.repeat(40), strayOid]) {
      extra.set(4, { state: 'MERGED', mergeCommit: { oid } });
      const mgr = new SourceManager(fx.root, { gh });
      const c = await changesOf(mgr, fx.root, 4);
      assert.equal(c.state, 'MERGED');
      assert.equal(c.headCommit, pr4.headOid, oid);
      assert.equal(c.mergeBase, pr4.headOid, oid);
      assert.deepEqual(c.files, []);
      assert.equal(typeof c.note, 'string');
      const reader = await mgr.reader({ kind: 'pr', number: 4 }, false);
      assert.ok(!('error' in reader));
      assert.equal(reader.commit, pr4.headOid);
      await mgr.idle();
    }
    // oid 꼴이 아니면 mergeCommit 으로 받지 않는다(git 인자로 넘기지 않는다).
    extra.set(4, { state: 'MERGED', mergeCommit: { oid: '--output=/tmp/x' } });
    const mgr = new SourceManager(fx.root, { gh });
    const c = await changesOf(mgr, fx.root, 4);
    assert.equal('mergeCommit' in c, false);
    assert.equal(c.headCommit, pr4.headOid);
    await mgr.idle();
  });

  it('캐시된 동안 PR 이 머지되면 다시 뜬다(상태가 캐시 키에 든다)', async () => {
    let t = 5_000_000;
    const now = (): number => t;
    let diffs = 0;
    const spy: typeof git = (root, args, o) => {
      if (args.includes('--name-status')) diffs += 1;
      return git(root, args, o);
    };
    // gh 메타는 0.5초 ttl, 변경 목록 캐시는 60초 — 메타만 새로 와도 다시 떠야 한다.
    const mgr = new SourceManager(fx.root, { gh, now, ttlMs: 500 });
    extra.set(4, { state: 'OPEN', mergeCommit: null });
    const open = await prChanges(mgr, fx.root, 4, { git: spy, now });
    assert.ok(isChanges(open));
    assert.equal(open.state, 'OPEN');
    // 열린 PR 로 보면 머리가 이미 base 안이라 비어 보인다 — 고친 버그의 모양.
    assert.deepEqual(open.files, []);
    await prChanges(mgr, fx.root, 4, { git: spy, now });
    assert.equal(diffs, 1);
    await mgr.idle();
    // 머지 커밋을 못 받은 MERGED 도 머리·base 가 같지만 다시 떠서 note 를 단다.
    extra.set(4, { state: 'MERGED', mergeCommit: { oid: 'f'.repeat(40) } });
    t += 1_000;
    const fallback = await prChanges(mgr, fx.root, 4, { git: spy, now });
    assert.ok(isChanges(fallback));
    assert.equal(diffs, 2);
    assert.equal(typeof fallback.note, 'string');
    await mgr.idle();
    extra.set(4, { state: 'MERGED', mergeCommit: { oid: merge4 } });
    t += 1_000;
    const merged = await prChanges(mgr, fx.root, 4, { git: spy, now });
    assert.ok(isChanges(merged));
    assert.equal(diffs, 3);
    assert.equal(merged.headCommit, merge4);
    assert.equal(merged.files.length, 2);
    assert.equal('note' in merged, false);
    await mgr.idle();
  });
});
