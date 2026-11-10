// /api/viewer-spec — viewer.yml 의 빌드 산출물이 이 소스에 있는지·스펙보다 오래됐는지. 읽기만 한다.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import type { GitAsyncFn } from '../../server/git.ts';
import type { Ctx } from '../../server/handlers.ts';
import { createViewerServer } from '../../server/main.ts';
import { SourceManager } from '../../server/source.ts';
import { handleViewerSpec } from '../../server/viewer-spec.ts';
import { makeGitFixture, type GitFixture } from '../helpers/git-fixture.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const SPEC = 'projects/demo/config/viewer.yml';
const OUT = 'projects/demo/outputs/viewer/index.html';
const BARE = 'projects/demo/outputs/paper/viewer.yml';
const NOBUILD = 'projects/other/config/viewer.yml';

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

describe('/api/viewer-spec', () => {
  let fx: GitFixture;
  let distTmp: string;
  let server: http.Server;
  let base: string;

  before(async () => {
    fx = makeGitFixture();
    fx.commitOnMaster({ [SPEC]: 'title: demo\n', [OUT]: '<!doctype html><title>demo</title>\n', [BARE]: 'title: x\n', [NOBUILD]: 'title: o\n' }, 'viewer');
    // PR 7 은 산출물 없는 새 스펙을 더한다.
    fx.openPr(7, 'master', { 'projects/pr-only/config/viewer.yml': 'title: p\n' }, 'PR 7');
    fs.mkdirSync(path.join(fx.root, 'private', 'p', 'config'), { recursive: true });
    fs.writeFileSync(path.join(fx.root, 'private', 'p', 'config', 'viewer.yml'), 'title: s\n');
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

  const get = async (q: string): Promise<{ status: number; json: Json }> => {
    const res = await fetch(`${base}/api/viewer-spec?${q}`);
    return { status: res.status, json: (await res.json()) as Json };
  };

  it('local: 산출물이 있고 둘 다 깨끗하면 커밋 시각으로 견준다(같은 커밋 → 최신)', async () => {
    const { status, json } = await get(`path=${SPEC}`);
    assert.equal(status, 200);
    assert.equal(json.project, 'projects/demo');
    assert.equal(json.output, OUT);
    assert.equal(json.exists, true);
    assert.equal(json.basis, 'commit');
    assert.equal(json.stale, false);
    assert.equal(typeof json.specTime, 'number');
  });

  it('git 소스: main·pr 도 그 소스의 산출물을 본다', async () => {
    assert.equal((await get(`path=${SPEC}&src=main`)).json.exists, true);
    const pr = await get(`path=${SPEC}&src=pr:7`);
    assert.equal(pr.status, 200);
    assert.equal(pr.json.exists, true);
    assert.equal(pr.json.basis, 'commit');
    const only = await get('path=projects/pr-only/config/viewer.yml&src=pr:7');
    assert.equal(only.json.exists, false);
    assert.equal(only.json.stale, null);
    // PR 에만 있는 스펙은 local 에 없다.
    assert.equal((await get('path=projects/pr-only/config/viewer.yml')).status, 404);
  });

  it('산출물이 없거나 빌드 대상 위치가 아니면 exists: false', async () => {
    const none = await get(`path=${NOBUILD}`);
    assert.equal(none.json.exists, false);
    assert.equal(none.json.output, 'projects/other/outputs/viewer/index.html');
    const bare = await get(`path=${BARE}`);
    assert.equal(bare.json.project, null);
    assert.equal(bare.json.output, null);
    assert.equal(bare.json.exists, false);
  });

  it('viewer.yml 이 아니면 400, private·없는 경로는 404', async () => {
    assert.equal((await get('path=wiki/alpha.md')).status, 400);
    assert.equal((await get('path=private/p/config/viewer.yml')).status, 404);
    assert.equal((await get('path=projects/nope/config/viewer.yml')).status, 404);
    assert.equal((await get('path=../x/config/viewer.yml')).status, 404);
  });

  it('local: 하나라도 고쳤으면 디스크 mtime 으로 견준다 — 스펙을 나중에 고치면 오래됨', async () => {
    const abs = path.join(fx.root, SPEC);
    const prev = fs.readFileSync(abs, 'utf8');
    try {
      fs.writeFileSync(abs, `${prev}# 고침\n`);
      const later = new Date(Date.now() + 60_000);
      fs.utimesSync(abs, later, later);
      const { json } = await get(`path=${SPEC}`);
      assert.equal(json.basis, 'mtime');
      assert.equal(json.stale, true);
    } finally {
      fs.writeFileSync(abs, prev);
    }
  });

  it('커밋 시각: 산출물 커밋이 스펙 커밋보다 이르면 오래됨, git 소스는 그 소스의 커밋에서 센다', async () => {
    const ctx = { root: fx.root, includePrivate: false, sources: new SourceManager(fx.root, { gh: fx.gh }) } as unknown as Ctx;
    const calls: string[][] = [];
    const run: GitAsyncFn = async (_root, args) => {
      calls.push(args);
      if (args.includes('status')) return { ok: true, stdout: '', stderr: '' };
      const t = args.at(-1) === SPEC ? '2000' : '1000';
      return { ok: true, stdout: `${t}\n`, stderr: '' };
    };
    const local = await handleViewerSpec(ctx, new URL(`http://x/api/viewer-spec?path=${SPEC}`), run);
    assert.equal(local.status, 200);
    assert.deepEqual(
      { stale: (local.body as Json).stale, specTime: (local.body as Json).specTime, outputTime: (local.body as Json).outputTime },
      { stale: true, specTime: 2_000_000, outputTime: 1_000_000 },
    );
    assert.ok(calls.some((a) => a.includes('log') && a.includes('HEAD')));
    calls.length = 0;
    const pr = await handleViewerSpec(ctx, new URL(`http://x/api/viewer-spec?path=${SPEC}&src=pr:7`), run);
    assert.equal((pr.body as Json).stale, true);
    // pr 소스는 git status 를 부르지 않고, HEAD 가 아니라 PR 커밋에서 센다.
    assert.equal(calls.some((a) => a.includes('status')), false);
    assert.equal(calls.some((a) => a.includes('HEAD')), false);
    // 시각을 못 읽으면 모름(null)이다.
    const blind: GitAsyncFn = async () => ({ ok: false, stdout: '', stderr: 'x' });
    const unknown = await handleViewerSpec(ctx, new URL(`http://x/api/viewer-spec?path=${SPEC}&src=main`), blind);
    assert.equal((unknown.body as Json).stale, null);
    assert.equal((unknown.body as Json).basis, null);
  });
});
