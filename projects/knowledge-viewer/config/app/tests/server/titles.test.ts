// /api/titles: lint 범위 md 의 경로·제목 전부. raw·archive·private·gitignore 는 없다. 캐시하지 않는다.
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createViewerServer } from '../../server/main.ts';
import { makeFixtureVault } from '../helpers/fixture.ts';

type Item = { path: string; title: string };

describe('/api/titles', () => {
  let fx: ReturnType<typeof makeFixtureVault>;
  let distTmp: string;
  let server: http.Server;
  let base: string;

  beforeEach(async () => {
    fx = makeFixtureVault();
    distTmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kv-dist-'));
    server = createViewerServer({ root: fx.root, includePrivate: true, distDir: path.join(distTmp, 'dist') });
    base = await new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
    });
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    fx.cleanup();
    fs.rmSync(distTmp, { recursive: true, force: true });
  });

  it('lint 범위 md 전부를 경로순으로, 제목과 함께 준다', async () => {
    const res = await fetch(`${base}/api/titles`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    const body = (await res.json()) as { version: number; items: Item[] };
    assert.equal(typeof body.version, 'number');
    const paths = body.items.map((i) => i.path);
    assert.deepEqual(paths, [...paths].sort());
    assert.ok(paths.includes('wiki/alpha.md'));
    assert.ok(paths.includes('projects/demo/beta.md'));
    assert.equal(body.items.find((i) => i.path === 'wiki/alpha.md')?.title, '알파');
    // 검색 범위 밖은 없다 — includePrivate 서버라도 private 는 lint 범위 밖이다.
    assert.ok(!paths.includes('raw/beta.md'));
    assert.ok(!paths.some((p) => p.startsWith('private/')));
    assert.ok(!paths.includes('outputs/local.md'));
    assert.ok(!paths.some((p) => p.startsWith('node_modules/') || p.startsWith('dist/')));
  });

  it('src 질의가 있어도 디스크 색인 그대로다', async () => {
    const a = (await (await fetch(`${base}/api/titles`)).json()) as { items: Item[] };
    const b = (await (await fetch(`${base}/api/titles?src=main`)).json()) as { items: Item[] };
    assert.deepEqual(b.items, a.items);
  });
});
