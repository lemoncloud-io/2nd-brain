import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { VaultIndex } from '../../server/index-store.ts';
import { createViewerServer } from '../../server/main.ts';
import { startWatch } from '../../server/watch.ts';
import { makeFixtureVault } from '../helpers/fixture.ts';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('startWatch', () => {
  let fx: ReturnType<typeof makeFixtureVault>;
  let index: VaultIndex;
  let calls: string[];
  let stop: () => void;

  beforeEach(async () => {
    fx = makeFixtureVault();
    index = new VaultIndex(fx.root);
    index.build();
    calls = [];
    stop = startWatch(fx.root, index, (p) => calls.push(p), { debounceMs: 50 });
    // macOS FSEvents 는 감시를 시작한 직후의 쓰기를 놓칠 수 있다. 자리 잡을 때까지 잠시 기다린 뒤 시작 전 소음을 비운다.
    await sleep(300);
    calls.length = 0;
  });
  afterEach(() => {
    stop();
    fx.cleanup();
  });

  const waitFor = async (p: string, ms = 1000): Promise<void> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (calls.includes(p)) return;
      await sleep(20);
    }
    assert.fail(`${p} 알림이 ${ms}ms 안에 오지 않았다: ${JSON.stringify(calls)}`);
  };

  it('md 변경: 색인을 고친 뒤 onChange를 부른다', async () => {
    assert.ok(!index.backlinks('wiki/alpha.md').some((b) => b.path === 'wiki/beta.md'));
    fs.appendFileSync(path.join(fx.root, 'wiki', 'beta.md'), '\n[[alpha]]\n');
    await waitFor('wiki/beta.md');
    assert.ok(index.backlinks('wiki/alpha.md').some((b) => b.path === 'wiki/beta.md'));
  });

  it('새 md 는 색인에 들고, 지우면 빠진다', async () => {
    const f = path.join(fx.root, 'wiki', 'gamma.md');
    fs.writeFileSync(f, '# 감마\n');
    await waitFor('wiki/gamma.md');
    assert.ok(index.files.has('wiki/gamma.md'));
    calls.length = 0;
    fs.rmSync(f);
    await waitFor('wiki/gamma.md');
    assert.ok(!index.files.has('wiki/gamma.md'));
  });

  it('gitignore 된 md 는 색인에 넣지 않는다', async () => {
    fs.writeFileSync(path.join(fx.root, 'outputs', 'local.md'), '# 로컬\n');
    await waitFor('outputs/local.md');
    assert.ok(!index.files.has('outputs/local.md'));
  });

  it('raw 는 알리지만 색인에 넣지 않는다', async () => {
    fs.mkdirSync(path.join(fx.root, 'raw'), { recursive: true });
    fs.writeFileSync(path.join(fx.root, 'raw', 'x.md'), '# x\n');
    await waitFor('raw/x.md');
    assert.ok(!index.files.has('raw/x.md'));
  });

  it('제외 폴더(node_modules)와 private 는 알리지 않는다', async () => {
    fs.mkdirSync(path.join(fx.root, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(fx.root, 'node_modules', 'y.md'), '# y\n');
    fs.writeFileSync(path.join(fx.root, 'private', 'p.md'), '# 바뀜\n');
    await sleep(400);
    assert.deepEqual(calls, []);
  });

  it('폴더 이름을 바꾸면 옛 경로는 빠지고 새 경로가 역링크와 함께 든다', async () => {
    assert.ok(index.files.has('wiki/alpha.md'));
    fs.renameSync(path.join(fx.root, 'wiki'), path.join(fx.root, 'wiki2'));
    const settled = (): boolean =>
      ![...index.files].some((f) => f.startsWith('wiki/')) &&
      ['wiki2/INDEX.md', 'wiki2/alpha.md', 'wiki2/beta.md'].every((f) => index.files.has(f)) &&
      index.backlinks('wiki2/alpha.md').some((b) => b.path === 'wiki2/INDEX.md');
    const end = Date.now() + 3000;
    while (Date.now() < end && !settled()) await sleep(25);
    assert.deepEqual([...index.files].filter((f) => f.startsWith('wiki/')), []);
    for (const f of ['wiki2/INDEX.md', 'wiki2/alpha.md', 'wiki2/beta.md']) assert.ok(index.files.has(f), f);
    assert.ok(index.backlinks('wiki2/alpha.md').some((b) => b.path === 'wiki2/INDEX.md'));
    assert.ok(index.backlinks('wiki2/beta.md').some((b) => b.path === 'wiki2/alpha.md'));
    assert.deepEqual(index.backlinks('wiki/alpha.md'), []);
  });

  it('멈춘 뒤에는 알리지 않는다', async () => {
    stop();
    fs.appendFileSync(path.join(fx.root, 'wiki', 'beta.md'), '\n더\n');
    await sleep(400);
    assert.deepEqual(calls, []);
  });
});

describe('GET /api/events', () => {
  let fx: ReturnType<typeof makeFixtureVault>;
  let server: http.Server;

  beforeEach(() => {
    fx = makeFixtureVault();
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    fx.cleanup();
  });

  const start = async (watch: boolean): Promise<number> => {
    const distDir = path.join(fs.realpathSync(os.tmpdir()), 'kv-no-dist');
    server = createViewerServer({ root: fx.root, includePrivate: false, distDir, watch });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    return (server.address() as AddressInfo).port;
  };

  const open = (port: number, headers: http.OutgoingHttpHeaders = {}): Promise<{ res: http.IncomingMessage; req: http.ClientRequest }> =>
    new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/events', headers }, (res) => resolve({ res, req }));
      req.on('error', reject);
    });

  it('text/event-stream 헤더를 준다(watch:false)', async () => {
    const port = await start(false);
    const { res, req } = await open(port);
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['content-type']), /^text\/event-stream/);
    assert.equal(res.headers['cache-control'], 'no-cache');
    req.destroy();
  });

  it('파일이 바뀌면 changed 이벤트를 보낸다', async () => {
    const port = await start(true);
    const { res, req } = await open(port);
    const got = new Promise<string>((resolve) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
        buf += c;
        if (buf.includes('event: changed')) resolve(buf);
      });
    });
    await sleep(100);
    fs.appendFileSync(path.join(fx.root, 'wiki', 'beta.md'), '\n[[alpha]]\n');
    const buf = await Promise.race([got, sleep(3000).then(() => 'timeout')]);
    req.destroy();
    assert.match(buf, /event: changed\ndata: wiki\/beta\.md\n\n/);
  });

  it('SSE 연결이 열려 있어도 close 가 끝난다', async () => {
    const port = await start(false);
    const { res } = await open(port);
    res.resume();
    const closed = await Promise.race([
      new Promise<string>((r) => server.close(() => r('closed'))),
      sleep(2000).then(() => 'timeout'),
    ]);
    assert.equal(closed, 'closed');
  });

  it('다른 Origin 은 403이다', async () => {
    const port = await start(false);
    const { res, req } = await open(port, { Origin: 'http://evil.example' });
    assert.equal(res.statusCode, 403);
    req.destroy();
  });
});
