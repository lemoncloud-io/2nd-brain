// /api/doc 의 위키 이미지 임베드 풀이(`![[그림.png]]` → 소스의 이미지 목록)와 /raw 의 private 이미지 차단.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createViewerServer } from '../../server/main.ts';
import { SourceManager } from '../../server/source.ts';
import { makeGitFixture, type GitFixture } from '../helpers/git-fixture.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PIC_MD = '# 그림\n\n![[shot.png|640]]\n\n![[secret.png]]\n\n![[none.png]]\n\n[[shot.png]]\n';

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

const asHost = (at: string, hostname: string, p: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const u = new URL(at);
    const req = http.request({ host: '127.0.0.1', port: u.port, path: p, headers: { Host: `${hostname}:${u.port}` } }, (r) => {
      r.resume();
      r.on('end', () => resolve(r.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });

describe('위키 이미지 임베드 · private 이미지', () => {
  let fx: GitFixture;
  let distTmp: string;
  const servers: http.Server[] = [];

  const start = async (includePrivate: boolean): Promise<string> => {
    const server = createViewerServer({
      root: fx.root,
      includePrivate,
      distDir: path.join(distTmp, 'dist'),
      watch: false,
      gh: fx.gh,
      sources: new SourceManager(fx.root, { gh: fx.gh }),
      log: () => {},
    });
    servers.push(server);
    return listen(server);
  };

  before(() => {
    fx = makeGitFixture();
    fx.commitOnMaster({ 'wiki/pic.md': PIC_MD, 'outputs/assets/pic/shot.png': 'PNG' }, 'pic');
    // private/ 는 커밋하지 않는다(픽스처 .gitignore) — 디스크에만 둔다.
    fs.mkdirSync(path.join(fx.root, 'private'), { recursive: true });
    fs.writeFileSync(path.join(fx.root, 'private', 'secret.png'), 'PNG');
    distTmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kv-dist-'));
  });
  after(async () => {
    for (const s of servers) await close(s);
    fx.cleanup();
    fs.rmSync(distTmp, { recursive: true, force: true });
  });

  const embeds = (json: Json): Record<string, string | null> =>
    Object.fromEntries((json.links as Json[]).filter((l) => l.embed).map((l) => [l.target, l.path]));

  it('local: 파일명만 적은 이미지 임베드를 디스크 이미지 목록으로 푼다 — private 는 includePrivate 일 때만', async () => {
    const withPrivate = await start(true);
    const a = (await (await fetch(`${withPrivate}/api/doc?path=wiki/pic.md`)).json()) as Json;
    assert.deepEqual(embeds(a), { 'shot.png': 'outputs/assets/pic/shot.png', 'secret.png': 'private/secret.png', 'none.png': null });
    // 임베드 아닌 [[shot.png]] 는 풀지 않는다(앱 안 이동 링크가 되지 않게).
    assert.equal((a.links as Json[]).find((l) => !l.embed && l.target === 'shot.png')?.path, null);

    const noPrivate = await start(false);
    const b = (await (await fetch(`${noPrivate}/api/doc?path=wiki/pic.md`)).json()) as Json;
    assert.deepEqual(embeds(b), { 'shot.png': 'outputs/assets/pic/shot.png', 'secret.png': null, 'none.png': null });
  });

  it('src=main: git 트리의 이미지로 푼다 — private 는 담지 않는다', async () => {
    const base = await start(true);
    const json = (await (await fetch(`${base}/api/doc?path=wiki/pic.md&src=main`)).json()) as Json;
    assert.deepEqual(embeds(json), { 'shot.png': 'outputs/assets/pic/shot.png', 'secret.png': null, 'none.png': null });
  });

  it('/raw: private 이미지는 로컬 소스(includePrivate)에서만 읽힌다 — git 소스 /raw/@main/private/… 는 404', async () => {
    const withPrivate = await start(true);
    assert.equal(await asHost(withPrivate, '127.0.0.1', '/raw/private/secret.png'), 200);
    assert.equal(await asHost(withPrivate, '127.0.0.1', '/raw/outputs/assets/pic/shot.png'), 200);
    for (const p of ['/raw/@main/private/secret.png', '/raw/@main/PRIVATE/secret.png', '/raw/@main/Private%2Fsecret.png']) {
      assert.equal(await asHost(withPrivate, 'localhost', p), 404, p);
    }
    assert.equal(await asHost(withPrivate, 'localhost', '/raw/@main/outputs/assets/pic/shot.png'), 200);

    const noPrivate = await start(false);
    assert.equal(await asHost(noPrivate, '127.0.0.1', '/raw/private/secret.png'), 404);
  });
});
