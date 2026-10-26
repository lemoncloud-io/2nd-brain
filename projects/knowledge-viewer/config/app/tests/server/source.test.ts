import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { git, gitBytes } from '../../server/git.ts';
import { SourceManager, gitReader, localReader, redactReason, type SourceReader } from '../../server/source.ts';
import { LOCAL, MAIN } from '../../shared/source.ts';
import { DISK_LINE, makeGitFixture, type GitFixture } from '../helpers/git-fixture.ts';
import { makeFixtureVault } from '../helpers/fixture.ts';

const MASTER = 'refs/remotes/origin/master';
const PR_ALPHA = '---\ntype: concept\n---\n\n# 알파(PR)\n\nPR 에서 고친 알파다.\n';
const NEW_MD = '# 새 문서\n\nPR 이 더한 문서다.\n';

/** git 스파이. fetch 호출 수를 센다. */
function spyGit(): { fn: typeof git; fetches: () => number } {
  const calls: string[][] = [];
  const fn: typeof git = (root, args, opts) => {
    calls.push(args);
    return git(root, args, opts);
  };
  return { fn, fetches: () => calls.filter((a) => a[0] === 'fetch').length };
}

function isReader(r: SourceReader | { error: string }): r is SourceReader {
  return !('error' in r);
}

async function readerOf(m: SourceManager, ...args: Parameters<SourceManager['reader']>): Promise<SourceReader> {
  const r = await m.reader(...args);
  if (!isReader(r)) throw new Error(`reader 실패: ${r.error}`);
  return r;
}

describe('git 소스 리더', () => {
  let fx: GitFixture;
  let masterAlpha: string;
  let prHead: string;

  before(() => {
    fx = makeGitFixture();
    // 심링크를 커밋한다(git 트리 모드 120000).
    fs.symlinkSync('alpha.md', path.join(fx.root, 'wiki', 'link.md'));
    fx.commitOnMaster({}, 'symlink');
    masterAlpha = fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'vault', 'wiki', 'alpha.md'), 'utf8');
    prHead = fx.openPr(1, 'master', { 'wiki/alpha.md': PR_ALPHA, 'wiki/new.md': NEW_MD }, 'PR 1').headOid;
  });
  after(() => fx.cleanup());

  it('픽스처의 세 상태가 서로 다르다(디스크·master·PR)', () => {
    const disk = fs.readFileSync(path.join(fx.root, 'wiki', 'alpha.md'), 'utf8');
    assert.ok(disk.includes(DISK_LINE));
    assert.notEqual(disk, masterAlpha);
    assert.notEqual(masterAlpha, PR_ALPHA);
    assert.equal(fs.existsSync(path.join(fx.root, 'wiki', 'new.md')), false);
  });

  it('gitReader(origin/master) 는 master 내용을 읽는다', () => {
    const r = gitReader(fx.root, MASTER);
    assert.equal(r.kind, 'main');
    assert.equal(r.ref, MASTER);
    assert.equal(r.readText('wiki/alpha.md'), masterAlpha);
    assert.equal(r.exists('wiki/new.md'), false);
    assert.equal(r.readText('wiki/new.md'), null);
    assert.match(r.head ?? '', /^[0-9a-f]{4,}$/);
  });

  it('한글·공백 경로를 읽는다', () => {
    const r = gitReader(fx.root, MASTER);
    assert.match(r.readText('raw/한글 파일.md') ?? '', /# 원본 한글/);
    assert.deepEqual(r.readBytes('raw/한글 파일.md'), fs.readFileSync(path.join(fx.root, 'raw', '한글 파일.md')));
  });

  it('심링크(모드 120000)는 목록·읽기·존재 모두에서 빠진다', () => {
    const r = gitReader(fx.root, MASTER);
    assert.equal(r.list('wiki').some((e) => e.name === 'link.md'), false);
    assert.equal(r.readText('wiki/link.md'), null);
    assert.equal(r.exists('wiki/link.md'), false);
    assert.equal(r.listAll().includes('wiki/link.md'), false);
  });

  it('경로 검사: .. · 제외 폴더 · private · 폴더는 읽지 않는다', () => {
    const r = gitReader(fx.root, MASTER);
    for (const rel of ['../x.md', 'wiki/../wiki/alpha.md', 'node_modules/x.md', 'NODE_MODULES/x.md', 'private/p.md', 'wiki', '/wiki/alpha.md', '']) {
      assert.equal(r.readText(rel), null, rel);
      assert.equal(r.exists(rel), false, rel);
    }
    assert.throws(() => r.list('private'));
    assert.throws(() => r.list('node_modules'));
    assert.throws(() => r.list('../x'));
    assert.throws(() => r.list('없는폴더'));
    assert.throws(() => r.list('wiki/alpha.md'));
  });

  it('NUL 이 든 경로는 두 리더 모두 던지지 않고 null/false 다', () => {
    const readers = [gitReader(fx.root, MASTER), localReader(fx.root, false), localReader(fx.root, true)];
    for (const r of readers) {
      for (const rel of ['wiki/a\u0000b.md', 'a\u0000', 'wiki/alpha.md\u0000']) {
        assert.equal(r.readText(rel), null, `${r.kind} ${JSON.stringify(rel)}`);
        assert.equal(r.readBytes(rel), null);
        assert.equal(r.exists(rel), false);
      }
      assert.throws(() => r.list('wiki\u0000'), (e: unknown) => e instanceof Error && !('code' in e && e.code === 'ERR_INVALID_ARG_VALUE'));
    }
  });

  it('list 는 폴더 먼저·이름순, 점·제외 폴더를 숨긴다', () => {
    const r = gitReader(fx.root, MASTER);
    const top = r.list('');
    const names = top.map((e) => e.name);
    assert.deepEqual(top.filter((e) => e.kind === 'dir').map((e) => e.name), ['outputs', 'projects', 'raw', 'wiki']);
    assert.equal(names.includes('.gitignore'), false);
    assert.equal(names.includes('node_modules'), false);
    assert.equal(names.includes('dist'), false);
    assert.equal(names.includes('private'), false);
    assert.equal(names.at(-1), 'VAULT_RULES.md');
    const outputs = r.list('outputs/');
    assert.deepEqual(outputs, [{ name: 'a.html', path: 'outputs/a.html', kind: 'html', ignored: false }]);
  });

  it('SourceManager pr:1 리더는 PR 내용을 읽는다', async () => {
    const m = new SourceManager(fx.root, { gh: fx.gh });
    const r = await readerOf(m, { kind: 'pr', number: 1 }, false);
    assert.equal(r.kind, 'pr');
    assert.equal(r.ref, 'refs/kv/pr/1');
    assert.equal(r.readText('wiki/alpha.md'), PR_ALPHA);
    assert.equal(r.exists('wiki/new.md'), true);
    assert.equal(r.readText('wiki/new.md'), NEW_MD);
    const all = r.listAll();
    assert.ok(all.includes('wiki/new.md'));
    assert.ok(all.includes('wiki/alpha.md'));
    assert.equal(all.includes('raw/beta.md'), false);
    assert.equal(all.includes('node_modules/x.md'), false);
    assert.equal(all.includes('dist/y.md'), false);
    assert.equal(all.includes('private/p.md'), false);
    assert.deepEqual(all, [...all].sort());
    const wiki = r.list('wiki');
    assert.deepEqual(wiki.find((e) => e.name === 'new.md'), { name: 'new.md', path: 'wiki/new.md', kind: 'md', ignored: false });
    // base ref 도 받아 둔다(디프 기준용).
    assert.equal(git(fx.root, ['rev-parse', '--verify', '--quiet', 'refs/kv/base/master']).ok, true);
    assert.equal(git(fx.root, ['rev-parse', 'refs/kv/pr/1']).stdout.trim(), prHead);
    const st = m.status({ kind: 'pr', number: 1 });
    assert.equal(st.available, true);
    assert.equal(st.reason, undefined);
    assert.equal(typeof st.fetchedAt, 'number');
    assert.ok(prHead.startsWith(st.head ?? '-'));
  });

  it('스택 PR(base pr-1)도 base ref 를 받는다', async () => {
    fx.openPr(2, 'pr-1', { 'wiki/beta.md': '# 베타(PR 2)\n' }, 'PR 2');
    const m = new SourceManager(fx.root, { gh: fx.gh });
    const r = await readerOf(m, { kind: 'pr', number: 2 }, false);
    assert.equal(r.readText('wiki/beta.md'), '# 베타(PR 2)\n');
    assert.equal(r.readText('wiki/alpha.md'), PR_ALPHA);
    assert.equal(git(fx.root, ['rev-parse', '--verify', '--quiet', 'refs/kv/base/pr-1']).ok, true);
  });

  it('없는 PR 은 {error}, status 는 available:false + reason', async () => {
    const m = new SourceManager(fx.root, { gh: fx.gh });
    const r = await m.reader({ kind: 'pr', number: 99 }, false);
    assert.ok('error' in r);
    const st = m.status({ kind: 'pr', number: 99 });
    assert.equal(st.available, false);
    assert.equal(typeof st.reason, 'string');
  });

  it('prMeta 는 gh 결과를 PrMeta 로 바꾸고 60초 캐시한다', async () => {
    let calls = 0;
    const gh: typeof fx.gh = async (args, cwd) => {
      calls += 1;
      return fx.gh(args, cwd);
    };
    let t = 1_000;
    const m = new SourceManager(fx.root, { gh, now: () => t });
    const meta = await m.prMeta(1);
    assert.deepEqual(meta, {
      number: 1,
      title: 'PR 1',
      author: 't',
      head: 'pr-1',
      base: 'master',
      headOid: prHead,
      updatedAt: '2026-10-23T00:00:00Z',
      url: 'https://example.test/pull/1',
    });
    await m.prMeta(1);
    assert.equal(calls, 1);
    t += 60_001;
    await m.prMeta(1);
    assert.equal(calls, 2);
    const missing = await m.prMeta(42);
    assert.ok('error' in missing);
  });

  it('같은 PR 의 prMeta 동시 호출은 gh 를 한 번만 부른다', async () => {
    let calls = 0;
    const gh: typeof fx.gh = async (args, cwd) => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return fx.gh(args, cwd);
    };
    const m = new SourceManager(fx.root, { gh });
    const [a, b, c] = await Promise.all([m.prMeta(1), m.prMeta(1), m.reader({ kind: 'pr', number: 1 }, false)]);
    assert.equal(calls, 1);
    assert.deepEqual(a, b);
    assert.ok(isReader(c));
  });

  it('gh 가 동기로 던져도 prMeta 는 {error} 를 주고 다음 호출은 gh 를 다시 부른다', async () => {
    let calls = 0;
    const gh: typeof fx.gh = (args, cwd) => {
      calls += 1;
      if (calls === 1) throw new Error('spawn 실패 /Users/someone/bin/gh');
      return fx.gh(args, cwd);
    };
    const m = new SourceManager(fx.root, { gh });
    const first = await m.prMeta(1);
    assert.ok('error' in first);
    assert.equal(first.error.includes('/Users/'), false, first.error);
    const second = await m.prMeta(1);
    assert.equal(calls, 2);
    assert.ok(!('error' in second));
    assert.equal(second.headOid, prHead);
  });

  it('gh 가 거부(reject)해도 진행 중 항목이 지워지고 다음 호출이 다시 시도한다', async () => {
    let calls = 0;
    const gh: typeof fx.gh = async (args, cwd) => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return fx.gh(args, cwd);
    };
    const m = new SourceManager(fx.root, { gh });
    const [a, b] = await Promise.all([m.prMeta(1), m.prMeta(1)]);
    assert.equal(calls, 1);
    assert.ok('error' in a);
    assert.deepEqual(a, b);
    const next = await m.prMeta(1);
    assert.equal(calls, 2);
    assert.ok(!('error' in next));
  });

  it('prMeta 실패 사유도 절대경로를 가린다', async () => {
    const m = new SourceManager(fx.root, { gh: async () => ({ stdout: '', stderr: "fatal: not a git repository: '/private/tmp/x/.git'\nmore", status: 1 }) });
    const r = await m.prMeta(5);
    assert.ok('error' in r);
    assert.equal(r.error, "gh 실패: fatal: not a git repository: '<path>'");
  });

  it('위험한 base 이름은 fetch 하지 않는다', async () => {
    const spy = spyGit();
    const gh: typeof fx.gh = async () => ({
      stdout: JSON.stringify({ number: 7, title: 'x', author: { login: 't' }, headRefName: 'h', baseRefName: 'a:b', headRefOid: prHead, updatedAt: '', url: '' }),
      stderr: '',
      status: 0,
    });
    const m = new SourceManager(fx.root, { gh, git: spy.fn });
    const r = await m.reader({ kind: 'pr', number: 7 }, false);
    assert.ok('error' in r);
    assert.equal(spy.fetches(), 0);
  });

  it('main 리더는 60초 안 두 번째 호출에 fetch 를 다시 하지 않는다', async () => {
    const spy = spyGit();
    let t = 5_000;
    const m = new SourceManager(fx.root, { git: spy.fn, gh: fx.gh, now: () => t });
    const r1 = await readerOf(m, MAIN, false);
    assert.equal(r1.readText('wiki/alpha.md'), masterAlpha);
    assert.equal(spy.fetches(), 1);
    t += 59_000;
    await readerOf(m, MAIN, false);
    assert.equal(spy.fetches(), 1);
    t += 2_000;
    await readerOf(m, MAIN, false);
    assert.equal(spy.fetches(), 2);
    await m.idle();
    const st = m.status(MAIN);
    assert.equal(st.available, true);
    assert.equal(st.fetchedAt, t);
  });

  it('local 리더는 디스크를 읽는다', async () => {
    const m = new SourceManager(fx.root, { gh: fx.gh });
    const r = await readerOf(m, LOCAL, false);
    assert.equal(r.kind, 'local');
    assert.equal(r.ref, null);
    assert.ok(r.readText('wiki/alpha.md')?.includes(DISK_LINE));
    assert.equal(r.readText('private/p.md'), null);
    assert.equal(r.exists('wiki/new.md'), false);
    assert.equal(r.readText('../x.md'), null);
    assert.match(r.head ?? '', /^[0-9a-f]{4,}$/);
    const priv = localReader(fx.root, true);
    assert.match(priv.readText('private/p.md') ?? '', /비공개/);
    assert.ok(r.listAll().includes('wiki/alpha.md'));
    assert.ok(r.list('wiki').some((e) => e.name === 'alpha.md'));
    assert.equal(m.status(LOCAL).available, true);
  });
});

describe('fetch 실패', () => {
  it('fetch 가 실패해도 옛 ref 가 있으면 리더를 주고 status 에 사유를 남긴다', async () => {
    const fx = makeGitFixture();
    try {
      let t = 0;
      const m = new SourceManager(fx.root, { gh: fx.gh, now: () => t });
      await readerOf(m, MAIN, false);
      // fetch 는 뒤에서 돈다(stale-while-revalidate). 끝을 기다린 뒤 본다.
      await m.idle();
      assert.equal(m.status(MAIN).reason, undefined);
      fs.rmSync(fx.originDir, { recursive: true, force: true });
      t += 60_001;
      const r = await readerOf(m, MAIN, false);
      await m.idle();
      assert.match(r.readText('wiki/alpha.md') ?? '', /# 알파/);
      const st = m.status(MAIN);
      assert.equal(st.available, true);
      assert.equal(typeof st.reason, 'string');
      assert.notEqual(st.head, null);
      assert.equal(st.fetchedAt, 0);
      // 사유는 첫 줄만, 절대경로는 가린다.
      assert.equal(st.reason!.includes(fx.originDir), false, st.reason);
      assert.equal(/\/(Users|private|tmp|var)\//.test(st.reason!), false, st.reason);
      assert.match(st.reason!, /<path>/);
      assert.equal(st.reason!.includes('\n'), false);
    } finally {
      fx.cleanup();
    }
  });

  it('ref 조차 없는 새 저장소에서 main 리더는 {error}', async () => {
    const { root, cleanup } = makeFixtureVault();
    try {
      const m = new SourceManager(root, { gh: async () => ({ stdout: '', stderr: 'no', status: 1 }) });
      const r = await m.reader(MAIN, false);
      assert.ok('error' in r);
      const st = m.status(MAIN);
      assert.equal(st.available, false);
      assert.equal(st.head, null);
      assert.equal(st.fetchedAt, null);
      assert.equal(typeof st.reason, 'string');
    } finally {
      cleanup();
    }
  });
});

describe('git 래퍼', () => {
  it('예외를 던지지 않고 ok:false 를 준다', () => {
    const { root, cleanup } = makeFixtureVault();
    try {
      const r = git(root, ['rev-parse', '--verify', 'refs/heads/없음']);
      assert.equal(r.ok, false);
      assert.equal(typeof r.stderr, 'string');
      assert.equal(git(path.join(root, '없는폴더'), ['status']).ok, false);
      const nul = git(root, ['show', 'HEAD:a\u0000b']);
      assert.equal(nul.ok, false);
      assert.equal(nul.stdout, '');
      assert.equal(gitBytes(root, ['show', 'HEAD:a\u0000b']), null);
    } finally {
      cleanup();
    }
  });
});

describe('redactReason', () => {
  it('첫 줄만 남기고 절대경로를 <path> 로 가린다', () => {
    assert.equal(
      redactReason("fatal: '/private/tmp/kv-x/origin.git' does not appear to be a git repository\nfatal: Could not read from remote repository."),
      "fatal: '<path>' does not appear to be a git repository",
    );
    assert.equal(redactReason('error: cannot open /Users/someone/v/.git/FETCH_HEAD: Permission denied'), 'error: cannot open <path>: Permission denied');
    assert.equal(redactReason('fatal: unable to access https://example.test/o/r.git/: timeout'), 'fatal: unable to access https://example.test/o/r.git/: timeout');
    assert.equal(redactReason("fatal: couldn't find remote ref refs/heads/x"), "fatal: couldn't find remote ref refs/heads/x");
    assert.equal(redactReason('\n\n'), '');
  });

  it('file:// 로컬 주소도 가린다', () => {
    assert.equal(redactReason("fatal: 'file:///Users/someone/origin.git' does not appear to be a git repository"), "fatal: '<path>' does not appear to be a git repository");
    assert.equal(redactReason('fatal: unable to read file:///private/tmp/x/y.git: gone'), 'fatal: unable to read <path>: gone');
    assert.equal(redactReason('see https://example.test/a/b'), 'see https://example.test/a/b');
  });
});
