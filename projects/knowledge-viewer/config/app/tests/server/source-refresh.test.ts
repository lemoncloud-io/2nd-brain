// fetch 는 비동기 갱신(stale-while-revalidate)이고, git 소스 트리 제목은 blob oid 캐시 + cat-file --batch 한 번이다.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { git, gitBytes, type GitAsyncFn } from '../../server/git.ts';
import { handleTree, type Ctx } from '../../server/handlers.ts';
import { SourceManager, type SourceReader } from '../../server/source.ts';
import { LOCAL, MAIN } from '../../shared/source.ts';
import { makeGitFixture, type GitFixture } from '../helpers/git-fixture.ts';

function isReader(r: SourceReader | { error: string }): r is SourceReader {
  return !('error' in r);
}

/** 손으로 풀어 주는 느린 fetch. 부를 때마다 대기 하나를 쌓고, release 가 진짜 git 으로 끝낸다. */
function slowFetch(): { fn: GitAsyncFn; calls: string[][]; pending: () => number; release: () => void } {
  const calls: string[][] = [];
  const waiters: (() => void)[] = [];
  const fn: GitAsyncFn = (root, args) => {
    calls.push(args);
    return new Promise((resolve) => waiters.push(() => resolve(git(root, args))));
  };
  return {
    fn,
    calls,
    pending: () => waiters.length,
    release: () => {
      for (const w of waiters.splice(0)) w();
    },
  };
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('SourceManager — 비동기 fetch 갱신', () => {
  let fx: GitFixture;
  before(() => {
    fx = makeGitFixture();
    fx.openPr(1, 'master', { 'wiki/new.md': '# 새 문서\n' }, 'PR 1');
  });
  after(() => fx.cleanup());

  it('ref 가 있으면 ttl 이 지나도 리더를 바로 주고, fetch 는 뒤에서 돈다', async () => {
    const slow = slowFetch();
    let t = 0;
    const m = new SourceManager(fx.root, { gh: fx.gh, fetchGit: slow.fn, now: () => t });
    // 픽스처는 이미 refs/remotes/origin/master 가 있다 — 첫 요청도 기다리지 않는다.
    const r = await m.reader(MAIN, false);
    assert.ok(isReader(r));
    assert.equal(slow.calls.length, 1);
    assert.equal(slow.pending(), 1);
    // fetch 가 걸려 있는 동안 다른 소스·경로도 답한다.
    const local = await m.reader(LOCAL, false);
    assert.ok(isReader(local));
    const again = await m.reader(MAIN, false);
    assert.ok(isReader(again));
    assert.equal(again.readText('wiki/alpha.md')?.includes('# 알파'), true);
    assert.equal(slow.calls.length, 1, '진행 중 fetch 를 나눠 쓴다');
    slow.release();
    await m.idle();
    assert.equal(m.status(MAIN).fetchedAt, 0);
    assert.equal(m.status(MAIN).reason, undefined);
  });

  it('main 동시 요청 둘은 fetch 한 번', async () => {
    const slow = slowFetch();
    let t = 0;
    const m = new SourceManager(fx.root, { gh: fx.gh, fetchGit: slow.fn, now: () => t });
    const [a, b] = await Promise.all([m.reader(MAIN, false), m.reader(MAIN, false)]);
    assert.ok(isReader(a) && isReader(b));
    assert.equal(slow.calls.length, 1);
    slow.release();
    await m.idle();
    // ttl 안이면 다시 받지 않는다. 지나면 다시 받는다.
    t += 59_000;
    await m.reader(MAIN, false);
    assert.equal(slow.calls.length, 1);
    t += 2_000;
    await m.reader(MAIN, false);
    assert.equal(slow.calls.length, 2);
    slow.release();
    await m.idle();
    assert.equal(m.status(MAIN).fetchedAt, t);
  });

  it('ref 가 없으면 fetch 를 기다린 뒤 준다 — 그동안 다른 요청은 답한다', async () => {
    git(fx.root, ['update-ref', '-d', 'refs/kv/pr/1']);
    const slow = slowFetch();
    const m = new SourceManager(fx.root, { gh: fx.gh, fetchGit: slow.fn });
    let settled = false;
    const pr = m.reader({ kind: 'pr', number: 1 }, false).then((r) => {
      settled = true;
      return r;
    });
    for (let i = 0; i < 5 && slow.pending() === 0; i += 1) await tick();
    assert.equal(slow.pending(), 1);
    assert.equal(settled, false);
    const main = await m.reader(MAIN, false);
    assert.ok(isReader(main));
    assert.equal(settled, false, 'pr 은 아직 fetch 를 기다린다');
    slow.release();
    // main 의 뒤 갱신도 풀어 준다(이 시점에 쌓였을 수 있다).
    const r = await pr;
    slow.release();
    assert.ok(isReader(r));
    assert.equal(r.readText('wiki/new.md'), '# 새 문서\n');
    await m.idle();
  });

  it('갱신이 실패해도 옛 ref 를 쓰고 reason 을 남긴다', async () => {
    let t = 0;
    const failing: GitAsyncFn = async () => ({ ok: false, stdout: '', stderr: "fatal: '/private/tmp/x/origin.git' does not appear to be a git repository\nmore" });
    const m = new SourceManager(fx.root, { gh: fx.gh, fetchGit: failing, now: () => t });
    const r = await m.reader(MAIN, false);
    assert.ok(isReader(r));
    await m.idle();
    const st = m.status(MAIN);
    assert.equal(st.available, true);
    assert.equal(st.fetchedAt, null);
    assert.equal(st.reason, "fetch 실패: fatal: '<path>' does not appear to be a git repository");
    assert.match(r.readText('wiki/alpha.md') ?? '', /# 알파/);
  });

  it('fetch 러너가 던져도 거부로 새지 않고 reason 이 남는다', async () => {
    const throwing: GitAsyncFn = () => Promise.reject(new Error('boom'));
    const m = new SourceManager(fx.root, { gh: fx.gh, fetchGit: throwing });
    const r = await m.reader(MAIN, false);
    assert.ok(isReader(r));
    await m.idle();
    assert.match(m.status(MAIN).reason ?? '', /fetch 실패: boom/);
  });
});

describe('git 소스 트리 제목 — blob oid 캐시 + cat-file --batch', () => {
  let fx: GitFixture;
  const N = 12;
  before(() => {
    fx = makeGitFixture();
    const files: Record<string, string> = {};
    for (let i = 0; i < N; i += 1) files[`notes/n${String(i).padStart(2, '0')}.md`] = `---\ntitle: 노트 ${i}\n---\n\n본문 ${i}\n`;
    files['notes/plain.md'] = '본문만 있는 글\n';
    files['notes/한글 제목.md'] = '# 한글 머리 🎉\n\n본문\n';
    fx.commitOnMaster(files, 'notes');
  });
  after(() => fx.cleanup());

  function spy(): { deps: { git: typeof git; gitBytes: typeof gitBytes }; calls: string[][] } {
    const calls: string[][] = [];
    return {
      calls,
      deps: {
        git: (root, args, o) => {
          calls.push(args);
          return git(root, args, o);
        },
        gitBytes: (root, args, o) => {
          calls.push(args);
          return gitBytes(root, args, o);
        },
      },
    };
  }

  const ctxOf = (sources: SourceManager): Ctx => ({ root: fx.root, includePrivate: false, index: null as never, titleCache: new Map(), sources, graphHub: 50 });
  const noFetch: GitAsyncFn = async () => ({ ok: true, stdout: '', stderr: '' });

  it(`md ${N + 2} 개 목록은 ls-tree 뒤 git 을 많아야 두 번 부른다`, async () => {
    const s = spy();
    const m = new SourceManager(fx.root, { ...s.deps, gh: fx.gh, fetchGit: noFetch });
    const res = await handleTree(ctxOf(m), new URL('http://x/api/tree?dir=notes&src=main'));
    assert.equal(res.status, 200);
    const entries = (res.body as { entries: { path: string; title?: string }[] }).entries;
    assert.equal(entries.length, N + 2);
    assert.equal(entries.find((e) => e.path === 'notes/n03.md')?.title, '노트 3');
    assert.equal(entries.find((e) => e.path === 'notes/plain.md')?.title, 'plain');
    assert.equal(entries.find((e) => e.path === 'notes/한글 제목.md')?.title, '한글 머리 🎉');
    const lsAt = s.calls.findIndex((a) => a.includes('ls-tree'));
    assert.ok(lsAt >= 0);
    const afterLs = s.calls.slice(lsAt + 1);
    assert.ok(afterLs.length <= 2, JSON.stringify(afterLs));
    assert.equal(s.calls.filter((a) => a[0] === 'cat-file').length, 1);
  });

  it('새 머리라도 blob 이 같으면 cat-file 을 다시 부르지 않는다', async () => {
    const s = spy();
    const m = new SourceManager(fx.root, { ...s.deps, gh: fx.gh, fetchGit: noFetch });
    const ctx = ctxOf(m);
    await handleTree(ctx, new URL('http://x/api/tree?dir=notes&src=main'));
    // notes 밖 파일만 바꿔 머리를 옮긴다.
    fx.commitOnMaster({ 'wiki/other.md': '# 다른 문서\n' }, 'other');
    git(fx.root, ['fetch', '-q', 'origin', 'master']);
    s.calls.length = 0;
    const res = await handleTree(ctx, new URL('http://x/api/tree?dir=notes&src=main'));
    assert.equal(res.status, 200);
    assert.equal(s.calls.filter((a) => a[0] === 'cat-file').length, 0, JSON.stringify(s.calls));
    const entries = (res.body as { entries: { path: string; title?: string }[] }).entries;
    assert.equal(entries.find((e) => e.path === 'notes/n11.md')?.title, '노트 11');
  });

  it('바뀐 blob 만 다시 읽는다', async () => {
    const s = spy();
    const m = new SourceManager(fx.root, { ...s.deps, gh: fx.gh, fetchGit: noFetch });
    const ctx = ctxOf(m);
    await handleTree(ctx, new URL('http://x/api/tree?dir=notes&src=main'));
    fx.commitOnMaster({ 'notes/n00.md': '# 고친 노트\n' }, 'edit');
    git(fx.root, ['fetch', '-q', 'origin', 'master']);
    s.calls.length = 0;
    const res = await handleTree(ctx, new URL('http://x/api/tree?dir=notes&src=main'));
    const entries = (res.body as { entries: { path: string; title?: string }[] }).entries;
    assert.equal(entries.find((e) => e.path === 'notes/n00.md')?.title, '고친 노트');
    const cat = s.calls.filter((a) => a[0] === 'cat-file');
    assert.equal(cat.length, 1);
    assert.ok(fs.existsSync(fx.root));
  });
});
