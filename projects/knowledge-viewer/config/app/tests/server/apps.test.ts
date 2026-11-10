// 앱 플러그인 계약(M1). 가짜 앱을 등록부 대신 꽂아 주소·앱별 토큰·보안 헤더·POST 예외·호스트 분할·실패 격리·저장소 경계를 본다.
// 설계: docs/superpowers/specs/2026-11-05-knowledge-viewer-app-plugins-design.md § 결정 2·3·4·6, § 주소·API 계약.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createViewerServer, type ViewerServer } from '../../server/main.ts';
import { matchAppApi, matchAppPage, tokenMatches } from '../../server/apps/host.ts';
import { assertApps, storeDirProblem, type AppServerContext, type ViewerApp } from '../../server/apps/registry.ts';
import { APP_PAGE_HEADERS, withAppToken } from '../../server/static.ts';
import { makeFixtureVault } from '../helpers/fixture.ts';

const INDEX = '<!doctype html><html><head><title>t</title></head><body><p>앱</p></body></html>\n';
const META = /<meta name="kv-app-token" content="([0-9a-f]{64})" \/>/;

type Res = { status: number; location?: string; type?: string; cache?: string; headers: http.IncomingHttpHeaders; body: string };

/** `/apps/<id>` 응답의 보안 헤더 넷(설계 결정 4 의 값 그대로, 소문자 이름). */
const SECURITY = {
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
} as const;

/** 127.0.0.1 로 접속하되 Host·메서드·머리·몸통을 정해 보낸다. */
const ask = (port: number, p: string, o: { host?: string; method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Res> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: p, method: o.method ?? 'GET', headers: { Host: o.host ?? `127.0.0.1:${port}`, ...o.headers } },
      (r) => {
        let body = '';
        r.setEncoding('utf8');
        r.on('data', (c: string) => (body += c));
        r.on('end', () => resolve({ status: r.statusCode ?? 0, location: r.headers.location, type: r.headers['content-type'], cache: r.headers['cache-control'], headers: r.headers, body }));
      },
    );
    req.on('error', reject);
    req.end(o.body);
  });

/** 시험 기록: 앱이 받은 ctx 와 닫힘. */
const seen: { ctx: AppServerContext[]; closed: string[]; created: string[] } = { ctx: [], closed: [], created: [] };

/** 가짜 앱: /api/apps/fake/ping 에 { pong, method, url, body } 로 답한다. basePath 는 앱이 스스로 뗀다. */
const fake: ViewerApp = {
  id: 'fake',
  title: '가짜 앱',
  storeDir: (root) => path.join(root, 'tmp', 'fake-app'),
  server: async (ctx) => {
    seen.ctx.push(ctx);
    seen.created.push('fake');
    return {
      handle(req, res) {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (c: string) => (body += c));
        req.on('end', () => {
          const rest = (req.url ?? '').slice(ctx.basePath.length);
          const text = JSON.stringify(rest.startsWith('/ping') ? { pong: true, method: req.method, url: req.url, rest, body } : { error: 'no' });
          res.writeHead(rest.startsWith('/ping') ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(text);
        });
      },
      async close() {
        seen.closed.push('fake');
      },
    };
  },
};

/** 둘째 가짜 앱: 토큰이 앱마다 다른지 본다. 받은 ctx 는 따로 적는다. */
const otherCtx: AppServerContext[] = [];
const fake2: ViewerApp = {
  id: 'fake2',
  title: '둘째 앱',
  server: async (ctx) => {
    otherCtx.push(ctx);
    return { handle: (_q, r) => r.end('{"pong":2}'), close: async () => {} };
  },
};

/** import 실패 앱: 없는 모듈을 지연 import 한다. */
const broken: ViewerApp = {
  id: 'broken',
  title: '깨진 앱',
  server: async () => {
    const missing = './no-such-app-module.ts';
    await import(missing);
    throw new Error('여기 오지 않는다');
  },
};

/** 저장소 경계를 어긴 앱: tmp/ 밖(볼트 wiki/)에 쓰겠다고 한다. server() 는 불리면 안 된다. */
const outside: ViewerApp = {
  id: 'outside',
  title: '경계 밖 앱',
  storeDir: (root) => path.join(root, 'wiki', 'store'),
  server: async () => {
    seen.created.push('outside');
    return { handle: (_q, r) => r.end('x'), close: async () => {} };
  },
};

describe('앱 플러그인', () => {
  let fx: ReturnType<typeof makeFixtureVault>;
  let distTmp: string;
  let server: ViewerServer;
  let port = 0;
  let token = '';
  let token2 = '';
  const same = (): Record<string, string> => ({ Origin: `http://127.0.0.1:${port}` });
  /** 그 앱 화면 meta 의 토큰. 앱마다 다르다. */
  const tokenFor = async (id: string): Promise<string> => META.exec((await ask(port, `/apps/${id}`)).body)?.[1] ?? '';

  before(async () => {
    fx = makeFixtureVault();
    distTmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kv-dist-'));
    const distDir = path.join(distTmp, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), INDEX);
    server = createViewerServer({
      root: fx.root,
      includePrivate: false,
      distDir,
      watch: false,
      embeddings: false,
      log: () => {},
      publicHosts: ['vault.test'],
      apps: [fake, fake2, broken, outside],
    });
    port = await new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
    const page = await ask(port, '/apps/fake');
    token = META.exec(page.body)?.[1] ?? '';
    token2 = META.exec((await ask(port, '/apps/fake2')).body)?.[1] ?? '';
  });
  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    fx.cleanup();
    fs.rmSync(distTmp, { recursive: true, force: true });
  });

  describe('화면 /apps/<id>', () => {
    it('127.0.0.1 은 SPA 에 토큰 meta 를 넣어 낸다(캐시 안 함)', async () => {
      const r = await ask(port, '/apps/fake');
      assert.equal(r.status, 200);
      assert.equal(r.type, 'text/html; charset=utf-8');
      assert.equal(r.cache, 'no-store');
      assert.match(r.body, META);
      assert.equal(r.body, INDEX.replace('</head>', `<meta name="kv-app-token" content="${token}" /></head>`));
      // 하위 경로·질의도 같은 화면, 같은 토큰(그 앱의 것).
      assert.equal(META.exec((await ask(port, '/apps/fake/x?agent=claude')).body)?.[1], token);
    });

    it('토큰은 앱마다 다르다 — 등록되지 않은 id 는 meta 없이 화면만', async () => {
      assert.match(token2, /^[0-9a-f]{64}$/);
      assert.notEqual(token2, token);
      // 다시 받아도 같은 앱은 같은 토큰.
      assert.equal(META.exec((await ask(port, '/apps/fake2/y')).body)?.[1], token2);
      const other = await ask(port, '/apps/other');
      assert.equal(other.status, 200);
      assert.equal(other.body, INDEX);
      assert.equal(other.cache, 'no-store');
    });

    it('/apps/<id> 응답은 보안 헤더 넷을 낸다(결정 4 값 그대로) — 등록 여부·하위 경로·개인 이름 모두', async () => {
      // 서버 상수도 시험의 문자열과 같다(이름만 대소문자 다름).
      assert.deepEqual(Object.fromEntries(Object.entries(APP_PAGE_HEADERS).map(([k, v]) => [k.toLowerCase(), v])), SECURITY);
      for (const [p, host] of [['/apps/fake', undefined], ['/apps/fake2/x?agent=claude', undefined], ['/apps/other', undefined], ['/apps/fake', 'vault.test']] as const) {
        const r = await ask(port, p, { host });
        assert.equal(r.status, 200, p);
        for (const [k, v] of Object.entries(SECURITY)) assert.equal(r.headers[k], v, `${p} ${k}`);
      }
      // HEAD 도 같은 헤더(몸통 없음).
      const h = await ask(port, '/apps/fake', { method: 'HEAD' });
      assert.equal(h.headers['content-security-policy'], SECURITY['content-security-policy']);
      assert.equal(h.body, '');
    });

    it('뷰어의 다른 경로 index.html 에는 앱 보안 헤더가 없다', async () => {
      for (const p of ['/', '/v', '/v/wiki/alpha.md', '/apps', '/apps/Bad_Id']) {
        const r = await ask(port, p);
        assert.equal(r.status, 200, p);
        for (const k of Object.keys(SECURITY)) assert.equal(r.headers[k], undefined, `${p} ${k}`);
      }
    });

    it('개인 이름도 앱 출처다', async () => {
      const r = await ask(port, '/apps/fake', { host: 'vault.test' });
      assert.equal(r.status, 200);
      assert.equal(META.exec(r.body)?.[1], token);
    });

    it('다른 경로의 index.html 에는 meta 가 없다 — 바이트 그대로', async () => {
      for (const p of ['/', '/v', '/v/wiki/alpha.md', '/apps', '/apps/Bad_Id']) {
        const r = await ask(port, p);
        assert.equal(r.status, 200, p);
        assert.equal(r.body, INDEX, p);
      }
      assert.equal((await ask(port, '/')).cache, 'no-cache');
    });

    it('결정 3: localhost·모르는 이름은 /apps 를 127.0.0.1 로 302 — 토큰을 내지 않는다', async () => {
      for (const host of [`localhost:${port}`, `evil.example:${port}`]) {
        const r = await ask(port, '/apps/fake?agent=claude', { host });
        assert.equal(r.status, 302, host);
        assert.equal(r.location, `http://127.0.0.1:${port}/apps/fake?agent=claude`, host);
        assert.doesNotMatch(r.body, META, host);
      }
    });
  });

  describe('API /api/apps/<id>/*', () => {
    it('GET: 토큰이 맞으면 앱이 req.url 을 그대로 받는다(basePath 는 앱이 뗀다)', async () => {
      const r = await ask(port, '/api/apps/fake/ping?x=1', { headers: { 'X-Workbench-Token': token } });
      assert.equal(r.status, 200);
      assert.deepEqual(JSON.parse(r.body), { pong: true, method: 'GET', url: '/api/apps/fake/ping?x=1', rest: '/ping?x=1', body: '' });
    });

    it('다른 앱의 토큰은 맞지 않는다: GET 401·POST 403, 그 앱은 부르지 않는다', async () => {
      const before = otherCtx.length;
      assert.equal((await ask(port, '/api/apps/fake2/ping', { headers: { 'X-Workbench-Token': token } })).status, 401);
      assert.equal((await ask(port, '/api/apps/fake2/ping', { method: 'POST', headers: { ...same(), 'X-Workbench-Token': token } })).status, 403);
      assert.equal((await ask(port, '/api/apps/fake/ping', { headers: { 'X-Workbench-Token': token2 } })).status, 401);
      assert.equal((await ask(port, '/api/apps/fake/ping', { method: 'POST', headers: { ...same(), 'X-Workbench-Token': token2 } })).status, 403);
      assert.equal(otherCtx.length, before);
      // 제 토큰이면 열린다.
      const ok = await ask(port, '/api/apps/fake2/ping', { headers: { 'X-Workbench-Token': token2 } });
      assert.equal(ok.status, 200);
      assert.equal(ok.body, '{"pong":2}');
      assert.equal(otherCtx.at(-1)?.token, token2);
    });

    it('GET: 토큰이 없거나 틀리면 401, 앱은 부르지 않는다', async () => {
      const no = await ask(port, '/api/apps/fake/ping');
      assert.equal(no.status, 401);
      assert.deepEqual(JSON.parse(no.body), { error: 'app token required' });
      assert.equal((await ask(port, '/api/apps/fake/ping', { headers: { 'X-Workbench-Token': token.slice(1) } })).status, 401);
      assert.equal((await ask(port, '/api/apps/fake/ping', { headers: { 'X-Workbench-Token': 'f'.repeat(64) } })).status, 401);
    });

    it('POST: 앱 출처 ∧ Origin 같은 출처 ∧ 토큰 셋 다면 앱으로 간다(몸통 그대로)', async () => {
      const r = await ask(port, '/api/apps/fake/ping', { method: 'POST', headers: { ...same(), 'X-Workbench-Token': token, 'Content-Type': 'application/json' }, body: '{"a":1}' });
      assert.equal(r.status, 200);
      assert.deepEqual(JSON.parse(r.body), { pong: true, method: 'POST', url: '/api/apps/fake/ping', rest: '/ping', body: '{"a":1}' });
      // 개인 이름: 같은 출처는 http://<이름>.
      const n = await ask(port, '/api/apps/fake/ping', { host: 'vault.test', method: 'POST', headers: { Origin: 'http://vault.test', 'X-Workbench-Token': token } });
      assert.equal(n.status, 200);
    });

    it('POST: 셋 중 하나라도 빠지면 403·405', async () => {
      // Origin 없음 → 403
      const noOrigin = await ask(port, '/api/apps/fake/ping', { method: 'POST', headers: { 'X-Workbench-Token': token } });
      assert.equal(noOrigin.status, 403);
      assert.deepEqual(JSON.parse(noOrigin.body), { error: 'origin required' });
      // 다른 출처 → 403
      for (const o of [`http://localhost:${port}`, 'http://evil.example', `https://127.0.0.1:${port}`]) {
        const r = await ask(port, '/api/apps/fake/ping', { method: 'POST', headers: { Origin: o, 'X-Workbench-Token': token } });
        assert.equal(r.status, 403, o);
        assert.deepEqual(JSON.parse(r.body), { error: 'cross-origin' }, o);
      }
      // 토큰 없음·틀림 → 403
      assert.equal((await ask(port, '/api/apps/fake/ping', { method: 'POST', headers: same() })).status, 403);
      assert.equal((await ask(port, '/api/apps/fake/ping', { method: 'POST', headers: { ...same(), 'X-Workbench-Token': 'nope' } })).status, 403);
      // 앱 출처가 아님(localhost·모르는 이름) → 405(메서드 관문)
      for (const host of [`localhost:${port}`, `evil.example:${port}`]) {
        const r = await ask(port, '/api/apps/fake/ping', { host, method: 'POST', headers: { Origin: `http://${host}`, 'X-Workbench-Token': token } });
        assert.equal(r.status, 405, host);
        assert.deepEqual(JSON.parse(r.body), { error: 'GET만 받는다' }, host);
      }
    });

    it('앱 밖 POST 는 그대로 405 — /api/apps 목록·잘못된 id·뷰어 /api 도', async () => {
      for (const p of ['/api/apps', '/api/apps/', '/api/apps/Bad_Id/ping', '/api/appsfake/ping', '/api/tree', '/apps/fake', '/']) {
        const r = await ask(port, p, { method: 'POST', headers: { ...same(), 'X-Workbench-Token': token } });
        assert.equal(r.status, 405, p);
      }
      // PUT·DELETE 는 앱 경로여도 405.
      for (const method of ['PUT', 'DELETE', 'PATCH']) {
        assert.equal((await ask(port, '/api/apps/fake/ping', { method, headers: { ...same(), 'X-Workbench-Token': token } })).status, 405, method);
      }
    });

    it('결정 3: localhost·모르는 이름은 /api/apps 를 받지 않는다 — GET 404·POST 405(맞는 토큰·같은 출처여도)', async () => {
      // 표: [메서드, 경로, 기대 상태, 기대 몸통]. localhost 는 디스크 /raw 능동 콘텐츠의 출처라 앱 API 출처가 되면 안 된다.
      const table: [string, string, number, string][] = [
        ['GET', '/api/apps', 404, '{"error":"not found"}'],
        ['GET', '/api/apps/fake/ping', 404, '{"error":"not found"}'],
        ['POST', '/api/apps/fake/ping', 405, '{"error":"GET만 받는다"}'],
      ];
      for (const host of [`localhost:${port}`, `evil.example:${port}`]) {
        for (const [method, p, status, body] of table) {
          const r = await ask(port, p, { host, method, headers: { Origin: `http://${host}`, 'X-Workbench-Token': token } });
          assert.equal(r.status, status, `${host} ${method} ${p}`);
          assert.equal(r.body, body, `${host} ${method} ${p}`);
          assert.equal(r.body.includes('pong'), false, `${host} ${method} ${p}`);
        }
      }
    });

    it('등록되지 않은 앱은 404', async () => {
      const r = await ask(port, '/api/apps/nope/ping', { headers: { 'X-Workbench-Token': token } });
      assert.equal(r.status, 404);
    });

    it('import 실패 앱은 그 앱만 503 {error, reason}, 다른 앱·뷰어는 돈다', async () => {
      const r = await ask(port, '/api/apps/broken/ping', { headers: { 'X-Workbench-Token': await tokenFor('broken') } });
      assert.equal(r.status, 503);
      const j = JSON.parse(r.body);
      assert.equal(j.error, '앱을 쓸 수 없다');
      assert.match(j.reason, /no-such-app-module/);
      assert.equal((await ask(port, '/api/apps/fake/ping', { headers: { 'X-Workbench-Token': token } })).status, 200);
      assert.equal((await ask(port, '/api/tree?dir=')).status, 200);
    });

    it('저장소 경계를 어긴 앱은 server() 를 부르지 않고 503', async () => {
      const r = await ask(port, '/api/apps/outside/ping', { headers: { 'X-Workbench-Token': await tokenFor('outside') } });
      assert.equal(r.status, 503);
      assert.match(JSON.parse(r.body).reason, /tmp\//);
      assert.equal(seen.created.includes('outside'), false);
    });

    it('앱 ctx: basePath·토큰·볼트 루트. 생성은 한 번', async () => {
      assert.equal(seen.ctx.length, 1);
      const ctx = seen.ctx[0]!;
      assert.equal(ctx.basePath, '/api/apps/fake');
      assert.equal(ctx.token, token);
      assert.equal(ctx.vaultRoot, fx.root);
      assert.equal(typeof ctx.log, 'function');
    });
  });

  describe('목록 GET /api/apps', () => {
    it('id·title·ready·reason — 토큰은 싣지 않는다', async () => {
      const r = await ask(port, '/api/apps');
      assert.equal(r.status, 200);
      const j = JSON.parse(r.body) as { apps: { id: string; title: string; ready: boolean; reason?: string }[] };
      assert.deepEqual(j.apps.map((a) => [a.id, a.title, a.ready]), [
        ['fake', '가짜 앱', true],
        ['fake2', '둘째 앱', true],
        ['broken', '깨진 앱', false],
        ['outside', '경계 밖 앱', false],
      ]);
      assert.equal('reason' in j.apps[0]!, false);
      assert.match(j.apps[2]!.reason ?? '', /no-such-app-module/);
      assert.match(j.apps[3]!.reason ?? '', /tmp\//);
      assert.equal(r.body.includes(token), false);
      assert.equal(r.body.includes(token2), false);
    });

    it('다른 출처는 403(뷰어 /api 규칙 그대로)', async () => {
      assert.equal((await ask(port, '/api/apps', { headers: { Origin: 'http://evil.example' } })).status, 403);
    });

    it('/api/info 에 토큰이 없다', async () => {
      const info = (await ask(port, '/api/info')).body;
      assert.equal(info.includes(token), false);
      assert.equal(info.includes(token2), false);
    });
  });
});

describe('앱 등록부·순수 함수', () => {
  it('앱 목록을 주지 않으면 앱 0 — /api/apps 는 빈 목록, /apps/<id> 는 토큰 없는 화면', async () => {
    const fx = makeFixtureVault();
    const distTmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kv-dist-'));
    const distDir = path.join(distTmp, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), INDEX);
    const s = createViewerServer({ root: fx.root, includePrivate: false, distDir, watch: false, embeddings: false, log: () => {} });
    const port = await new Promise<number>((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port)));
    try {
      const list = await ask(port, '/api/apps');
      assert.equal(list.status, 200);
      assert.deepEqual(JSON.parse(list.body), { apps: [] });
      const page = await ask(port, '/apps/demo-board');
      assert.equal(page.status, 200);
      assert.equal(META.test(page.body), false);
      assert.equal((await ask(port, '/api/apps/demo-board/x')).status, 404);
    } finally {
      await new Promise<void>((resolve) => {
        s.close(() => resolve());
        s.closeAllConnections();
      });
      fx.cleanup();
      fs.rmSync(distTmp, { recursive: true, force: true });
    }
  });

  it('id 문법·중복은 시작부터 거부', () => {
    const mk = (id: string): ViewerApp => ({ id, title: id, server: async () => ({ handle: () => {}, close: async () => {} }) });
    for (const bad of ['Fake', 'a_b', 'a/b', '', 'a.b', '../x']) assert.throws(() => assertApps([mk(bad)]), /앱 id/, bad);
    assert.throws(() => assertApps([mk('a'), mk('a')]), /겹친다/);
    assert.doesNotThrow(() => assertApps([mk('demo-board'), mk('w2')]));
  });

  it('createViewerServer 도 잘못된 id 를 거부한다', () => {
    const fx = makeFixtureVault();
    try {
      assert.throws(
        () =>
          createViewerServer({ root: fx.root, includePrivate: false, distDir: path.join(fx.root, 'no-dist'), watch: false, embeddings: false, log: () => {}, apps: [{ ...fake, id: 'Bad' }] }),
        /앱 id/,
      );
    } finally {
      fx.cleanup();
    }
  });

  it('저장소 경계: <root>/tmp/<폴더> 아래만', () => {
    const root = path.join(os.tmpdir(), 'kv-vault');
    const app = (dir: string): ViewerApp => ({ ...fake, storeDir: () => dir });
    assert.equal(storeDirProblem(app(path.join(root, 'tmp', 'demo', 'board')), root), null);
    assert.equal(storeDirProblem(app('tmp/x'), root), null);
    for (const bad of [path.join(root, 'tmp'), path.join(root, 'wiki'), path.join(root, 'tmp', '..', 'raw'), path.join(root, 'tmpx', 'a'), '/elsewhere/tmp/a', 'raw/a']) {
      assert.match(storeDirProblem(app(bad), root) ?? '', /tmp\//, bad);
    }
    assert.equal(storeDirProblem({ ...fake, storeDir: undefined }, root), null);
    assert.match(storeDirProblem({ ...fake, storeDir: () => { throw new Error('x'); } }, root) ?? '', /정하지 못했다/);
  });

  it('주소 매칭: 앱 API·앱 화면', () => {
    assert.equal(matchAppApi('/api/apps/fake'), 'fake');
    assert.equal(matchAppApi('/api/apps/fake/'), 'fake');
    assert.equal(matchAppApi('/api/apps/fake/a/b'), 'fake');
    for (const p of ['/api/apps', '/api/apps/', '/api/apps/Fake/x', '/api/apps/%66ake/x', '/api/appsx/fake', '/apps/fake']) assert.equal(matchAppApi(p), null, p);
    assert.equal(matchAppPage('/apps/fake'), 'fake');
    assert.equal(matchAppPage('/apps/fake/x'), 'fake');
    for (const p of ['/apps', '/apps/', '/apps/A', '/api/apps/fake']) assert.equal(matchAppPage(p), null, p);
  });

  it('토큰 비교: 길이가 달라도 던지지 않는다', () => {
    assert.equal(tokenMatches('ab', 'ab'), true);
    assert.equal(tokenMatches('ab', 'abc'), false);
    assert.equal(tokenMatches(undefined, 'ab'), false);
    assert.equal(tokenMatches(['ab'], 'ab'), false);
  });

  it('meta 넣기: </head> 앞, 없으면 맨 앞', () => {
    assert.equal(withAppToken('<head></head>', 'ab12'), '<head><meta name="kv-app-token" content="ab12" /></head>');
    assert.equal(withAppToken('<p>x</p>', 'ab'), '<meta name="kv-app-token" content="ab" /><p>x</p>');
    assert.equal(withAppToken('<head></head>', 'a"><script>'), '<head><meta name="kv-app-token" content="ac" /></head>');
  });
});

describe('앱 닫기', () => {
  it('뷰어 서버를 닫으면 만든 앱의 close 를 부른다', async () => {
    const fx = makeFixtureVault();
    const distTmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kv-dist-'));
    const distDir = path.join(distTmp, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), INDEX);
    const before = seen.closed.length;
    const s = createViewerServer({ root: fx.root, includePrivate: false, distDir, watch: false, embeddings: false, log: () => {}, apps: [fake] });
    const port = await new Promise<number>((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port)));
    const tok = META.exec((await ask(port, '/apps/fake')).body)?.[1] ?? '';
    assert.equal((await ask(port, '/api/apps/fake/ping', { headers: { 'X-Workbench-Token': tok } })).status, 200);
    await new Promise<void>((resolve) => {
      s.close(() => resolve());
      s.closeAllConnections();
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(seen.closed.length, before + 1);
    fx.cleanup();
    fs.rmSync(distTmp, { recursive: true, force: true });
  });
});
