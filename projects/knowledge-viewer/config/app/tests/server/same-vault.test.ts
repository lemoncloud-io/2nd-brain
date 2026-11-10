// same-vault.ts — 개인 이름 뒤의 상시 뷰어가 이 세션의 볼트 루트를 내는가(/api/info 의 rootId 대조).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createViewerServer, type ViewerServer } from '../../server/main.ts';
import { SourceManager } from '../../server/source.ts';
import { sameVault } from '../../same-vault.ts';
import { makeGitFixture, type GitFixture } from '../helpers/git-fixture.ts';

const listen = (server: http.Server): Promise<number> =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));

function close(server: ViewerServer): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

describe('sameVault', () => {
  let fx: GitFixture;
  let other: GitFixture;
  let named: ViewerServer;
  let plain: ViewerServer;
  let namedPort: number;
  let plainPort: number;

  before(async () => {
    fx = makeGitFixture();
    other = makeGitFixture();
    const make = (publicHosts?: string[]): ViewerServer =>
      createViewerServer({
        root: fx.root,
        includePrivate: false,
        distDir: path.join(fx.root, 'no-dist'),
        watch: false,
        embeddings: false,
        sources: new SourceManager(fx.root, { gh: fx.gh }),
        log: () => {},
        ...(publicHosts === undefined ? {} : { publicHosts }),
      });
    named = make(['vault.test']);
    plain = make();
    namedPort = await listen(named);
    await listen(named.gitServer);
    plainPort = await listen(plain);
    await listen(plain.gitServer);
  });
  after(async () => {
    await close(named);
    await close(plain);
    fx.cleanup();
    other.cleanup();
  });

  it('같은 볼트 루트면 same — 하위 폴더에서 불러도 루트를 찾아 견준다, 서버 주 포트를 함께 낸다', async () => {
    const url = `http://127.0.0.1:${namedPort}/v/wiki/alpha.md?agent=claude&src=local#x`;
    assert.deepEqual(await sameVault(url, fx.root), { same: true, port: namedPort, reason: '같은 볼트 루트' });
    assert.equal((await sameVault(url, path.join(fx.root, 'wiki'))).same, true);
  });

  it('다른 볼트 루트(워크트리 등)면 same 이 아니다', async () => {
    const r = await sameVault(`http://127.0.0.1:${namedPort}/`, other.root);
    assert.equal(r.same, false);
    assert.equal(r.port, namedPort);
    assert.match(r.reason, /다른 볼트 루트/);
  });

  it('git 워크트리는 메인 체크아웃과 다른 루트다', async () => {
    const wt = path.join(path.dirname(fx.root), 'wt');
    const add = spawnSync('git', ['-C', fx.root, 'worktree', 'add', '-q', '--detach', wt], { encoding: 'utf8' });
    assert.equal(add.status, 0, add.stderr);
    assert.equal((await sameVault(`http://127.0.0.1:${namedPort}/`, wt)).same, false);
  });

  it('설정이 없는 서버(rootId 없음)·꺼진 서버·볼트 밖·잘못된 주소는 same 이 아니다', async () => {
    const none = await sameVault(`http://127.0.0.1:${plainPort}/`, fx.root);
    assert.equal(none.same, false);
    assert.match(none.reason, /rootId 가 없다/);
    const off = http.createServer();
    const offPort = await listen(off);
    await new Promise<void>((r) => off.close(() => r()));
    assert.match((await sameVault(`http://127.0.0.1:${offPort}/`, fx.root)).reason, /읽지 못했다/);
    assert.match((await sameVault(`http://127.0.0.1:${namedPort}/`, path.dirname(path.dirname(fx.root)))).reason, /볼트 루트를 찾지 못했다/);
    assert.match((await sameVault('not a url', fx.root)).reason, /주소가 올바르지 않다/);
  });

  it('이름을 받지 않는 서버는 404 — same 이 아니다(가짜 fetch)', async () => {
    const fake = (async () => new Response('{"error":"not found"}', { status: 404 })) as typeof fetch;
    const r = await sameVault('http://vault.test/v/x', fx.root, fake);
    assert.equal(r.same, false);
    assert.match(r.reason, /404/);
  });
});
