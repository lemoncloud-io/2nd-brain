// git 소스(@main·@pr/<n>)의 능동 콘텐츠는 별도 루프백 포트(git 포트) 출처에서만 낸다.
// PR 이 실어 온 html 이 디스크 /raw(private·워크트리 수정 포함)와 같은 출처에 서지 않게 하려는 것이다(판정 12).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { git } from '../../server/git.ts';
import { createViewerServer, parseArgs, type ViewerServer } from '../../server/main.ts';
import type { GhRunner } from '../../server/panels/prs.ts';
import { SourceManager } from '../../server/source.ts';
import { makeGitFixture, type GitFixture } from '../helpers/git-fixture.ts';

const listen = (server: http.Server): Promise<number> =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));

function close(server: ViewerServer): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

type Res = { status: number; location?: string; headers: http.IncomingHttpHeaders; body: string };

/** 호스트 머리를 정해 보낸다. 경로는 그대로 간다. */
const asHost = (port: number, hostname: string, p: string): Promise<Res> =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, headers: { Host: `${hostname}:${port}` } }, (r) => {
      let body = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => (body += c));
      r.on('end', () => resolve({ status: r.statusCode ?? 0, location: r.headers.location, headers: r.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });

describe('git 소스 능동 콘텐츠 — 별도 포트 출처', () => {
  let fx: GitFixture;
  let distTmp: string;
  let server: ViewerServer;
  let port: number;
  let gitPort: number;
  const calls = { fetch: 0, gh: 0 };

  before(async () => {
    fx = makeGitFixture();
    fx.openPr(1, 'master', { 'outputs/a.html': '<!doctype html><p>PR 의 html</p>\n', 'outputs/pic.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>\n' }, 'PR 1');
    distTmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kv-dist-'));
    const spyGit: typeof git = (root, args, o) => {
      if (args[0] === 'fetch') calls.fetch += 1;
      return git(root, args, o);
    };
    const spyGh: GhRunner = (args, cwd) => {
      calls.gh += 1;
      return fx.gh(args, cwd);
    };
    server = createViewerServer({
      root: fx.root,
      includePrivate: true,
      distDir: path.join(distTmp, 'dist'),
      watch: false,
      gh: spyGh,
      sources: new SourceManager(fx.root, { git: spyGit, gh: spyGh }),
      log: () => {},
    });
    port = await listen(server);
    gitPort = await listen(server.gitServer);
  });
  after(async () => {
    await close(server);
    fx.cleanup();
    fs.rmSync(distTmp, { recursive: true, force: true });
  });

  it('주 포트의 /raw/@pr/1/*.html 은 두 호스트 모두 git 포트 localhost 로 302', async () => {
    for (const h of ['127.0.0.1', 'localhost']) {
      const r = await asHost(port, h, '/raw/@pr/1/outputs/a.html');
      assert.equal(r.status, 302, h);
      assert.equal(r.location, `http://localhost:${gitPort}/raw/@pr/1/outputs/a.html`, h);
    }
    const svg = await asHost(port, 'localhost', '/raw/@main/wiki/x.svg?q=1');
    assert.equal(svg.status, 302);
    assert.equal(svg.location, `http://localhost:${gitPort}/raw/@main/wiki/x.svg?q=1`);
  });

  it('주 포트의 git 소스 비능동 파일(md 등)은 그대로 낸다', async () => {
    const r = await asHost(port, 'localhost', '/raw/@pr/1/wiki/alpha.md');
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'text/markdown; charset=utf-8');
  });

  it('git 포트: 소스 접두 경로는 200 + nosniff·no-cache, CORS 없음', async () => {
    const r = await asHost(gitPort, 'localhost', '/raw/@pr/1/outputs/a.html');
    assert.equal(r.status, 200);
    assert.equal(r.body, '<!doctype html><p>PR 의 html</p>\n');
    assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['cache-control'], 'no-cache');
    assert.equal(r.headers['access-control-allow-origin'], undefined);
    const svg = await asHost(gitPort, '127.0.0.1', '/raw/@pr/1/outputs/pic.svg');
    assert.equal(svg.status, 200);
    assert.equal(svg.headers['content-type'], 'image/svg+xml');
    const md = await asHost(gitPort, 'localhost', '/raw/@main/wiki/alpha.md');
    assert.equal(md.status, 200);
  });

  it('git 포트: 디스크 /raw·/api·SPA 는 404', async () => {
    for (const p of ['/raw/private/p.md', '/raw/wiki/alpha.md', '/raw/%40main/wiki/alpha.md', '/api/tree', '/api/info', '/', '/v/wiki/alpha.md', '/assets/x.js', '/raw/@zzz/x']) {
      const r = await asHost(gitPort, 'localhost', p);
      assert.equal(r.status, 404, p);
    }
  });

  it('git 포트: 다른 Host 는 404, GET·HEAD 밖은 405', async () => {
    assert.equal((await asHost(gitPort, 'evil.test', '/raw/@pr/1/outputs/a.html')).status, 404);
    const post = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: gitPort, path: '/raw/@pr/1/outputs/a.html', method: 'POST', headers: { Host: `localhost:${gitPort}` } }, (r) => {
        r.resume();
        r.on('end', () => resolve(r.statusCode ?? 0));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(post, 405);
  });

  it('git 포트: private·.. 경로는 소스를 열지 않고 404(fetch·gh 없음)', async () => {
    const before = { ...calls };
    for (const p of ['/raw/@pr/1/private/x.md', '/raw/@main/private/x.md', '/raw/@pr/1/PRIVATE/x.html', '/raw/@pr/1/wiki%2F..%2Fx']) {
      assert.equal((await asHost(gitPort, 'localhost', p)).status, 404, p);
    }
    assert.deepEqual(calls, before);
  });

  it('주 포트 디스크 /raw 는 그대로다 — includePrivate 면 localhost 에서 private 도 낸다(디스크 html 의 출처)', async () => {
    const r = await asHost(port, 'localhost', '/raw/private/p.md');
    assert.equal(r.status, 200);
    assert.match(r.body, /비공개/);
    // 디스크 html 은 여전히 주 포트 localhost 다(127.0.0.1 이면 localhost 로 302).
    const h = await asHost(port, '127.0.0.1', '/raw/outputs/a.html');
    assert.equal(h.status, 302);
    assert.equal(h.location, `http://localhost:${port}/raw/outputs/a.html`);
  });

  it('/api/info 는 gitRawPort 를 알린다', async () => {
    const r = await asHost(port, '127.0.0.1', '/api/info');
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.body).gitRawPort, gitPort);
  });
});

describe('git 포트 인자', () => {
  it('기본은 없음(시작 때 port + 1), --git-port·환경 변수로 준다', () => {
    const env = {} as NodeJS.ProcessEnv;
    assert.equal(parseArgs([], env).gitPort, undefined);
    assert.equal(parseArgs(['--git-port', '9001'], env).gitPort, 9001);
    assert.equal(parseArgs([], { KNOWLEDGE_VIEWER_GIT_PORT: '9002' } as NodeJS.ProcessEnv).gitPort, 9002);
    assert.equal(parseArgs(['--git-port', '9003'], { KNOWLEDGE_VIEWER_GIT_PORT: '9002' } as NodeJS.ProcessEnv).gitPort, 9003);
    assert.throws(() => parseArgs(['--git-port', 'x'], env));
    assert.throws(() => parseArgs(['--port', '9000', '--git-port', '9000'], env));
  });
});

describe('listenViewer — git 포트가 막혀 있으면 시작을 멈춘다', () => {
  it('같은 출처로 물러서지 않고 분명한 오류로 거부한다', async () => {
    const { listenViewer } = await import('../../server/main.ts');
    const fx = makeGitFixture();
    const blocker = http.createServer();
    const taken = await listen(blocker);
    const s = createViewerServer({ root: fx.root, includePrivate: false, distDir: path.join(fx.root, 'no-dist'), watch: false, sources: new SourceManager(fx.root, { gh: fx.gh }), log: () => {} });
    try {
      await assert.rejects(listenViewer(s, 0, taken), (e: unknown) => e instanceof Error && /git 소스 포트/.test(e.message) && e.message.includes(String(taken)));
      assert.equal(s.listening, false, '주 포트도 닫는다');
      assert.equal(s.gitServer.listening, false);
      // 열리면 두 포트를 알려 준다.
      const ok = await listenViewer(s, 0, 0);
      assert.ok(ok.port > 0 && ok.gitPort > 0 && ok.port !== ok.gitPort);
      await close(s);
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
      fx.cleanup();
    }
  });
});
