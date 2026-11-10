// /api/project-viewer — viewer.yml 을 셸 model·loader 로 메모리에서 묶는다. 볼트에 쓰지 않는다.
// 데이터는 셸 시험 fixture(가상의 데모 프로젝트)를 git 볼트에 옮겨 쓴다.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import type { Ctx } from '../../server/handlers.ts';
import { createViewerServer } from '../../server/main.ts';
import { clearProjectViewerCache, handleProjectViewer, loadShell, type ShellLoader } from '../../server/project-viewer.ts';
import { SourceManager } from '../../server/source.ts';
import { makeGitFixture, type GitFixture } from '../helpers/git-fixture.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const MINI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../project-viewer/config/shell/tests/fixtures/mini');
const SPEC = 'projects/demo/config/viewer.yml';
const OVERVIEW = 'projects/demo/docs/overview.md';
const PR_LINE = 'PR 에서만 더한 줄';
const SECRET = '사적인 비밀 문장';

/** 셸 fixture 의 데모 프로젝트 파일들(볼트 상대경로 → 본문). */
function demoFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else out[path.relative(MINI, abs).split(path.sep).join('/')] = fs.readFileSync(abs, 'utf8');
    }
  };
  walk(path.join(MINI, 'projects'));
  return out;
}

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

describe('/api/project-viewer', () => {
  let fx: GitFixture;
  let distTmp: string;
  let server: http.Server;
  let base: string;
  let head: string;

  before(async () => {
    fx = makeGitFixture();
    const files = demoFiles();
    head = fx.commitOnMaster(files, 'demo viewer');
    // PR 7 은 개요 문서에 한 줄을 더한다.
    fx.openPr(7, 'master', { [OVERVIEW]: `${files[OVERVIEW]}\n${PR_LINE}\n` }, 'PR 7');
    // private 의 viewer.yml 과, private 원본을 가리키는 공개 viewer.yml.
    const priv = path.join(fx.root, 'private', 'p');
    fs.mkdirSync(path.join(priv, 'config'), { recursive: true });
    fs.writeFileSync(path.join(priv, 'config', 'viewer.yml'), files[SPEC]!);
    fs.writeFileSync(path.join(priv, 'secret.md'), `# 비밀\n\n${SECRET}\n`);
    const leak = files[SPEC]!.replace('path: projects/demo/docs/decisions.md', 'path: private/p/secret.md');
    fs.mkdirSync(path.join(fx.root, 'projects', 'leak', 'config'), { recursive: true });
    fs.writeFileSync(path.join(fx.root, 'projects', 'leak', 'config', 'viewer.yml'), leak);
    // 검사 오류: 없는 원본 id 를 근거로 쓴다.
    const broken = files[SPEC]!.replace('evidence: [{source: overview, at: "용어"}]', 'evidence: [{source: nope, at: "용어"}]');
    fs.mkdirSync(path.join(fx.root, 'projects', 'broken', 'config'), { recursive: true });
    fs.writeFileSync(path.join(fx.root, 'projects', 'broken', 'config', 'viewer.yml'), broken);
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

  const get = async (q: string): Promise<{ status: number; json: Json; text: string }> => {
    const res = await fetch(`${base}/api/project-viewer?${q}`);
    const text = await res.text();
    return { status: res.status, json: JSON.parse(text) as Json, text };
  };

  it('local: 셸 collect 로 묶은 Bundle — 원문·스탬프(커밋은 HEAD, 시각은 지금)', async () => {
    const { status, json } = await get(`path=${SPEC}`);
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.spec, SPEC);
    assert.equal(json.bundle.viewer.meta.title, '데모 프로젝트 뷰어');
    assert.ok(json.bundle.docs.overview.body.includes('# 데모 서비스 개요'));
    assert.equal(json.bundle.docs.overview.missing, false);
    assert.equal(json.bundle.stamp.commit, head.slice(0, 8));
    assert.equal(json.bundle.stamp.dirty, false);
    assert.ok(Math.abs(Date.parse(json.bundle.stamp.builtAt) - Date.now()) < 60_000);
    // 볼트에 아무것도 쓰지 않았다(산출물 폴더가 생기지 않는다).
    assert.equal(fs.existsSync(path.join(fx.root, 'projects', 'demo', 'outputs')), false);
  });

  it('git 소스: pr 은 그 PR 의 원본, main 은 커밋된 원본이다(디스크와 섞이지 않는다)', async () => {
    const pr = await get(`path=${SPEC}&src=pr:7`);
    assert.equal(pr.status, 200);
    assert.equal(pr.json.ok, true);
    assert.ok(pr.json.bundle.docs.overview.body.includes(PR_LINE));
    assert.equal(pr.json.bundle.stamp.dirty, false);
    assert.match(String(pr.json.bundle.stamp.commit), /^[0-9a-f]{7,8}$/);
    const main = await get(`path=${SPEC}&src=main`);
    assert.equal(main.json.ok, true);
    assert.ok(!main.json.bundle.docs.overview.body.includes(PR_LINE));
    // PR 에 없는 스펙은 404.
    assert.equal((await get('path=projects/nope/config/viewer.yml&src=pr:7')).status, 404);
  });

  it('경계: viewer.yml 이 아니면 400, private·`..`·없는 경로는 404', async () => {
    assert.equal((await get('path=wiki/alpha.md')).status, 400);
    assert.equal((await get('path=projects/demo/config/viewer.yaml')).status, 400);
    assert.equal((await get('path=private/p/config/viewer.yml')).status, 404);
    assert.equal((await get('path=../x/config/viewer.yml')).status, 404);
    assert.equal((await get('path=projects/demo/../demo/config/viewer.yml')).status, 404);
    assert.equal((await get('path=projects/nope/config/viewer.yml')).status, 404);
    assert.equal((await get('path=')).status, 404);
  });

  it('경계: 원본이 private 를 가리켜도 본문을 싣지 않는다(검사 오류로 돌려준다)', async () => {
    const { status, json, text } = await get('path=projects/leak/config/viewer.yml');
    assert.equal(status, 200);
    assert.equal(json.ok, false);
    assert.ok(json.issues.some((i: Json) => i.code === 'E_SOURCE_MISSING' && String(i.message).includes('private/p/secret.md')));
    assert.ok(!text.includes(SECRET));
  });

  it('검사 오류는 ok: false 와 목록', async () => {
    const { status, json } = await get('path=projects/broken/config/viewer.yml');
    assert.equal(status, 200);
    assert.equal(json.ok, false);
    assert.ok(json.issues.some((i: Json) => i.level === 'error' && i.code === 'E_SOURCE_UNKNOWN'));
  });

  it('캐시: 입력이 같으면 다시 묶지 않고, 원본을 고치면 다시 묶는다', async () => {
    clearProjectViewerCache();
    const ctx = { root: fx.root, includePrivate: false, sources: new SourceManager(fx.root, { gh: fx.gh }) } as unknown as Ctx;
    const real = await loadShell();
    let calls = 0;
    const counting = async (): Promise<ShellLoader> => ({
      ...real,
      collect: (o) => {
        calls += 1;
        return real.collect(o);
      },
    });
    const url = new URL(`http://x/api/project-viewer?path=${SPEC}`);
    const a = await handleProjectViewer(ctx, url, counting);
    const b = await handleProjectViewer(ctx, url, counting);
    assert.equal(calls, 1);
    assert.equal(b.body, a.body);
    const abs = path.join(fx.root, OVERVIEW);
    const prev = fs.readFileSync(abs, 'utf8');
    try {
      fs.writeFileSync(abs, `${prev}\n디스크에서 고친 줄\n`);
      const c = await handleProjectViewer(ctx, url, counting);
      assert.equal(calls, 2);
      const body = c.body as Json;
      assert.ok(body.bundle.docs.overview.body.includes('디스크에서 고친 줄'));
      assert.equal(body.bundle.stamp.dirty, true);
      // git 소스는 커밋이 같으면 다시 읽지 않는다.
      const prUrl = new URL(`http://x/api/project-viewer?path=${SPEC}&src=pr:7`);
      await handleProjectViewer(ctx, prUrl, counting);
      await handleProjectViewer(ctx, prUrl, counting);
      assert.equal(calls, 3);
    } finally {
      fs.writeFileSync(abs, prev);
    }
  });

  it('셸을 불러오지 못하면 503 과 설치 안내', async () => {
    const ctx = { root: fx.root, includePrivate: false, sources: new SourceManager(fx.root, { gh: fx.gh }) } as unknown as Ctx;
    const errors = console.error;
    console.error = () => {};
    try {
      const r = await handleProjectViewer(ctx, new URL(`http://x/api/project-viewer?path=${SPEC}`), () => Promise.reject(new Error('no deps')));
      assert.equal(r.status, 503);
      assert.match(String((r.body as Json).error), /npm ci/);
    } finally {
      console.error = errors;
    }
  });
});
