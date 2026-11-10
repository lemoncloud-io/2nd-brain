// 개인 이름(--public-host·KNOWLEDGE_VIEWER_PUBLIC_HOSTS). 설정이 없으면 호스트 분할이 오늘과 같다 — 표로 못 박는다.
// 설정한 이름은 127.0.0.1 처럼 화면·/api·/raw 를 받는다. 능동 콘텐츠는 localhost 로 보내지 않고 같은 호스트로 내되 CSP sandbox 로 격리한다.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { rootId } from '../../server/info.ts';
import { createViewerServer, parseArgs, parsePublicHosts, type ViewerServer } from '../../server/main.ts';
import { SourceManager } from '../../server/source.ts';
import { DISK_LINE, makeGitFixture, type GitFixture } from '../helpers/git-fixture.ts';

const INDEX = '<!doctype html><p>앱</p>\n';
const ASSET = 'console.log(1);\n';

const listen = (server: http.Server): Promise<number> =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));

function close(server: ViewerServer): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

type Res = { status: number; location?: string; type?: string; csp?: string; body: string };

/** 127.0.0.1 로 접속하되 Host 머리를 그대로 정해 보낸다(역프록시는 Host 를 바꾸지 않고 넘긴다 — 포트 없음). */
const ask = (port: number, host: string, p: string, headers: Record<string, string> = {}): Promise<Res> =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, headers: { Host: host, ...headers } }, (r) => {
      let body = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => (body += c));
      r.on('end', () => resolve({ status: r.statusCode ?? 0, location: r.headers.location, type: r.headers['content-type'], csp: r.headers['content-security-policy'] as string | undefined, body }));
    });
    req.on('error', reject);
    req.end();
  });

/** 경로 묶음. 능동(html)·비능동(md) × 디스크·git 소스, 화면·자산·/api, 없는 주소. */
const PATHS = {
  root: '/',
  view: '/v/wiki/alpha.md',
  asset: '/assets/a.js',
  api: '/api/tree?dir=',
  rawMd: '/raw/wiki/alpha.md',
  rawHtml: '/raw/outputs/a.html',
  gitHtml: '/raw/@main/outputs/a.html',
  gitMd: '/raw/@main/wiki/alpha.md',
  other: '/nope',
} as const;
type PathKey = keyof typeof PATHS;
type Want = { status: number; location?: string; type?: string; body?: string | RegExp };

const TEXT = 'text/plain; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';
const HTML = 'text/html; charset=utf-8';
const MD = 'text/markdown; charset=utf-8';
const NOT_FOUND: Want = { status: 404, type: TEXT, body: '없는 주소다' };

/** 오늘(설정 없음)의 호스트 분할 표. gitPort 는 그 서버의 실제 git 포트, hostPort 는 Host 머리의 포트('' 이면 없음). */
function todayTable(gitPort: number, kind: '127' | 'localhost' | 'other', hostPort: string): Record<PathKey, Want> {
  const hp = hostPort === '' ? '' : `:${hostPort}`;
  const toApp = (p: string): Want => ({ status: 302, location: `http://127.0.0.1${hp}${p}` });
  const toGit: Want = { status: 302, location: `http://localhost:${gitPort}${PATHS.gitHtml}` };
  const disk: Want = { status: 200, type: MD, body: new RegExp(DISK_LINE) };
  const main: Want = { status: 200, type: MD, body: /^(?![\s\S]*디스크에서만)/ };
  if (kind === '127')
    return {
      root: { status: 200, type: HTML, body: INDEX },
      view: { status: 200, type: HTML, body: INDEX },
      asset: { status: 200, body: ASSET },
      api: { status: 200, type: JSON_TYPE },
      rawMd: disk,
      rawHtml: { status: 302, location: `http://localhost${hp}${PATHS.rawHtml}` },
      gitHtml: toGit,
      gitMd: main,
      other: NOT_FOUND,
    };
  if (kind === 'localhost')
    return {
      root: toApp(PATHS.root),
      view: toApp(PATHS.view),
      asset: toApp(PATHS.asset),
      api: { status: 404, type: JSON_TYPE, body: '{"error":"not found"}' },
      rawMd: disk,
      rawHtml: { status: 200, type: HTML, body: /<html|<!doctype|<p/i },
      gitHtml: toGit,
      gitMd: main,
      other: NOT_FOUND,
    };
  return {
    root: toApp(PATHS.root),
    view: toApp(PATHS.view),
    asset: toApp(PATHS.asset),
    api: { status: 404, type: JSON_TYPE, body: '{"error":"not found"}' },
    rawMd: NOT_FOUND,
    rawHtml: NOT_FOUND,
    gitHtml: NOT_FOUND,
    gitMd: NOT_FOUND,
    other: NOT_FOUND,
  };
}

function check(r: Res, w: Want, label: string): void {
  assert.equal(r.status, w.status, label);
  assert.equal(r.location, w.location, label);
  if (w.type !== undefined) assert.equal(r.type, w.type, label);
  if (typeof w.body === 'string') assert.equal(r.body, w.body, label);
  else if (w.body instanceof RegExp) assert.match(r.body, w.body, label);
}

describe('개인 이름', () => {
  let fx: GitFixture;
  let distTmp: string;
  let plain: ViewerServer;
  let named: ViewerServer;
  const ports = { plain: 0, plainGit: 0, named: 0, namedGit: 0 };

  before(async () => {
    fx = makeGitFixture();
    distTmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kv-dist-'));
    const distDir = path.join(distTmp, 'dist');
    fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), INDEX);
    fs.writeFileSync(path.join(distDir, 'assets', 'a.js'), ASSET);
    const make = (publicHosts?: string[]): ViewerServer =>
      createViewerServer({
        root: fx.root,
        includePrivate: false,
        distDir,
        watch: false,
        embeddings: false,
        gh: fx.gh,
        sources: new SourceManager(fx.root, { gh: fx.gh }),
        log: () => {},
        // 호스트 분할만 본다 — 실제 앱(등록부)을 픽스처 볼트에 만들지 않게 빈 목록.
        apps: [],
        ...(publicHosts === undefined ? {} : { publicHosts }),
      });
    plain = make();
    named = make(['vault.test']);
    ports.plain = await listen(plain);
    ports.plainGit = await listen(plain.gitServer);
    ports.named = await listen(named);
    ports.namedGit = await listen(named.gitServer);
  });
  after(async () => {
    await close(plain);
    await close(named);
    fx.cleanup();
    fs.rmSync(distTmp, { recursive: true, force: true });
  });

  /** 한 서버에 대해 호스트 하나의 표 전체를 본다. */
  const runTable = async (port: number, gitPort: number, host: string, kind: '127' | 'localhost' | 'other', hostPort: string): Promise<void> => {
    const table = todayTable(gitPort, kind, hostPort);
    for (const key of Object.keys(PATHS) as PathKey[]) check(await ask(port, host, PATHS[key]), table[key], `${host} ${PATHS[key]}`);
  };

  describe('설정 없음 — 오늘의 표', () => {
    it('Host 127.0.0.1', async () => {
      await runTable(ports.plain, ports.plainGit, `127.0.0.1:${ports.plain}`, '127', String(ports.plain));
    });
    it('Host localhost', async () => {
      await runTable(ports.plain, ports.plainGit, `localhost:${ports.plain}`, 'localhost', String(ports.plain));
    });
    it('모르는 Host — 포트 있음·없음, 나중에 설정할 이름도 지금은 모르는 이름', async () => {
      await runTable(ports.plain, ports.plainGit, `evil.example:${ports.plain}`, 'other', String(ports.plain));
      await runTable(ports.plain, ports.plainGit, 'vault.test', 'other', '');
    });
    it('/api/info 에 rawPort·rootId 가 없다', async () => {
      const info = JSON.parse((await ask(ports.plain, `127.0.0.1:${ports.plain}`, '/api/info')).body);
      assert.equal(info.gitRawPort, ports.plainGit);
      assert.equal('rawPort' in info, false);
      assert.equal('rootId' in info, false);
    });
  });

  describe('설정 있음 — 다른 호스트는 그대로', () => {
    it('Host 127.0.0.1·localhost·모르는 이름은 설정 없음과 같은 표', async () => {
      await runTable(ports.named, ports.namedGit, `127.0.0.1:${ports.named}`, '127', String(ports.named));
      await runTable(ports.named, ports.namedGit, `localhost:${ports.named}`, 'localhost', String(ports.named));
      await runTable(ports.named, ports.namedGit, `evil.example:${ports.named}`, 'other', String(ports.named));
    });

    it('정확한 이름만 받는다 — 하위·상위·비슷한 이름은 모르는 이름', async () => {
      for (const h of ['sub.vault.test', 'vault.test.evil.example', 'vaulttest', 'vault.tes']) {
        await runTable(ports.named, ports.namedGit, h, 'other', '');
      }
    });

    it('본문도 바이트 단위로 같다(설정 없음 서버와 견준다)', async () => {
      for (const host of ['127.0.0.1', 'localhost', 'evil.example']) {
        for (const p of Object.values(PATHS)) {
          const a = await ask(ports.plain, `${host}:${ports.plain}`, p);
          const b = await ask(ports.named, `${host}:${ports.named}`, p);
          assert.equal(b.body, a.body, `${host} ${p}`);
          assert.equal(b.type, a.type, `${host} ${p}`);
        }
      }
    });

    it('앱 주소(/apps·/api/apps)도 같은 호스트 분할 — 앱 출처만 화면·API, 나머지는 302·404, 앱 밖 POST 는 405', async () => {
      const meta = /<meta name="kv-app-token" content="[0-9a-f]{64}" \/>/;
      // 이 서버엔 앱이 없다: /apps/x 는 토큰 meta 없이 화면만(보안 헤더는 낸다), /api/apps/x/* 는 404.
      for (const host of [`127.0.0.1:${ports.named}`, 'vault.test']) {
        const page = await ask(ports.named, host, '/apps/x');
        assert.equal(page.status, 200, host);
        assert.doesNotMatch(page.body, meta, host);
        assert.match(page.csp ?? '', /frame-ancestors 'none'/, host);
        const list = await ask(ports.named, host, '/api/apps');
        assert.equal(list.status, 200, host);
        assert.equal(list.body, '{"apps":[]}', host);
        assert.equal((await ask(ports.named, host, '/api/apps/x/ping')).status, 404, host);
      }
      for (const host of [`localhost:${ports.named}`, `evil.example:${ports.named}`, 'sub.vault.test']) {
        const hp = host.includes(':') ? `:${ports.named}` : '';
        check(await ask(ports.named, host, '/apps/x'), { status: 302, location: `http://127.0.0.1${hp}/apps/x` }, host);
        check(await ask(ports.named, host, '/api/apps'), { status: 404, type: JSON_TYPE, body: '{"error":"not found"}' }, host);
      }
      // 설정 없음 서버도 같다. 앱 화면 밖 index.html 에는 meta·보안 헤더가 없다.
      const root = await ask(ports.plain, `127.0.0.1:${ports.plain}`, '/');
      assert.doesNotMatch(root.body, meta);
      assert.equal(root.csp, undefined);
      assert.match((await ask(ports.plain, `127.0.0.1:${ports.plain}`, '/apps/x')).csp ?? '', /default-src 'self'/);
    });

    it('git 포트는 이름을 받지 않는다', async () => {
      check(await ask(ports.namedGit, 'vault.test', PATHS.gitHtml), { status: 404 }, 'git 포트');
    });
  });

  describe('설정한 이름 — 127.0.0.1 처럼', () => {
    for (const hostPort of ['', 'port']) {
      it(`화면·자산·/api·/raw 의 표 (Host 포트 ${hostPort === '' ? '없음 — 역프록시' : '있음'})`, async () => {
        const host = hostPort === '' ? 'vault.test' : `vault.test:${ports.named}`;
        const want: Record<PathKey, Want> = {
          root: { status: 200, type: HTML, body: INDEX },
          view: { status: 200, type: HTML, body: INDEX },
          asset: { status: 200, body: ASSET },
          api: { status: 200, type: JSON_TYPE },
          rawMd: { status: 200, type: MD, body: new RegExp(DISK_LINE) },
          // 능동 콘텐츠는 302 없이 같은 호스트로 낸다 — 그 페이지의 localhost 하위 요청은 브라우저가 끊는다.
          rawHtml: { status: 200, type: HTML, body: /<html|<!doctype|<p/i },
          gitHtml: { status: 200, type: HTML, body: /<html|<!doctype|<p/i },
          gitMd: { status: 200, type: MD },
          other: NOT_FOUND,
        };
        for (const key of Object.keys(PATHS) as PathKey[]) check(await ask(ports.named, host, PATHS[key]), want[key], `${host} ${PATHS[key]}`);
        // 능동 콘텐츠(디스크·git)는 CSP sandbox — allow-same-origin 이 없어 불투명 출처다. 비능동(md)에는 붙이지 않는다.
        for (const p of [PATHS.rawHtml, PATHS.gitHtml, `${PATHS.rawHtml}?x=1`, '/raw/outputs/a.htm%6C']) {
          const r = await ask(ports.named, host, p);
          assert.equal(r.status, 200, p);
          assert.equal(r.location, undefined, p);
          assert.equal(r.csp, 'sandbox allow-scripts allow-popups allow-forms', p);
          assert.doesNotMatch(r.csp ?? '', /allow-same-origin/, p);
        }
        for (const p of [PATHS.rawMd, PATHS.gitMd]) assert.equal((await ask(ports.named, host, p)).csp, undefined, p);
        // 없는 능동 파일도 302 가 아니라 404 다(localhost 로 보내지 않는다).
        for (const p of ['/raw/x.svg', '/raw/x.XHTML', '/raw/x.xml', '/raw/@main/x.svg']) assert.equal((await ask(ports.named, host, p)).status, 404, p);
      });
    }

    it('같은 출처 검사: Origin 은 http://<이름> 이어야 한다', async () => {
      assert.equal((await ask(ports.named, 'vault.test', PATHS.api, { Origin: 'http://vault.test' })).status, 200);
      for (const o of [`http://127.0.0.1:${ports.named}`, `http://localhost:${ports.named}`, 'http://vault.test:80', 'https://vault.test', 'http://evil.example', 'null']) {
        const r = await ask(ports.named, 'vault.test', PATHS.api, { Origin: o });
        assert.equal(r.status, 403, o);
        assert.equal(r.body, '{"error":"cross-origin"}', o);
      }
      // 'null' 은 CSP sandbox 로 낸 /raw 능동 콘텐츠(불투명 출처)의 스크립트다 — /api 를 읽지 못한다.
      // 거꾸로, 이름의 출처는 127.0.0.1 의 /api 를 읽지 못한다.
      assert.equal((await ask(ports.named, `127.0.0.1:${ports.named}`, PATHS.api, { Origin: 'http://vault.test' })).status, 403);
    });

    it('/api/events(SSE) 를 받는다', async () => {
      const first = await new Promise<{ status: number; type?: string; chunk: string }>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: ports.named, path: '/api/events', headers: { Host: 'vault.test', Origin: 'http://vault.test' } }, (r) => {
          r.setEncoding('utf8');
          r.once('data', (c: string) => {
            resolve({ status: r.statusCode ?? 0, type: r.headers['content-type'], chunk: c });
            req.destroy();
          });
        });
        req.on('error', reject);
        req.end();
      });
      assert.equal(first.status, 200);
      assert.equal(first.type, 'text/event-stream');
      assert.equal(first.chunk, ': connected\n\n');
    });

    it('/api/info 는 진짜 주 포트(rawPort)·git 포트·볼트 루트 지문을 알린다 — 경로는 싣지 않는다', async () => {
      const r = await ask(ports.named, 'vault.test', '/api/info');
      assert.equal(r.status, 200);
      const info = JSON.parse(r.body);
      assert.equal(info.rawPort, ports.named);
      assert.equal(info.gitRawPort, ports.namedGit);
      assert.equal(info.rootId, rootId(fx.root));
      assert.equal(r.body.includes(fx.root), false);
      // 127.0.0.1 로 물어도 같은 값이다(설정이 있는 서버).
      assert.equal(JSON.parse((await ask(ports.named, `127.0.0.1:${ports.named}`, '/api/info')).body).rootId, info.rootId);
    });
  });
});

describe('개인 이름 인자', () => {
  const env = {} as NodeJS.ProcessEnv;

  it('기본은 비어 있다. 환경 변수는 쉼표 구분, CLI(--public-host 반복)가 이긴다', () => {
    assert.deepEqual(parseArgs([], env).publicHosts, []);
    assert.deepEqual(parseArgs([], { KNOWLEDGE_VIEWER_PUBLIC_HOSTS: 'vault.test, notes.test,' } as NodeJS.ProcessEnv).publicHosts, ['vault.test', 'notes.test']);
    assert.deepEqual(parseArgs(['--public-host', 'a.test', '--public-host', 'b.test'], { KNOWLEDGE_VIEWER_PUBLIC_HOSTS: 'c.test' } as NodeJS.ProcessEnv).publicHosts, ['a.test', 'b.test']);
    assert.deepEqual(parsePublicHosts([], 'a.test,a.test'), ['a.test']);
    assert.deepEqual(parsePublicHosts([], ''), []);
    assert.deepEqual(parsePublicHosts(['vault'], undefined), ['vault']);
    assert.deepEqual(parsePublicHosts(['my-vault.localhost'], undefined), ['my-vault.localhost']);
  });

  it('소문자 DNS 이름만 — 포트·와일드카드·대문자·IP·루프백 이름·빈 라벨은 시작부터 거부', () => {
    for (const bad of ['Vault.test', 'vault.test:80', '*.test', 'vault.*', 'localhost', '127.0.0.1', '10.0.0.1', '[::1]', 'a..b', '.a.test', 'a.test.', '-a.test', 'a-.test', 'http://a.test', 'a_b.test', 'a b', 'x'.repeat(64) + '.test']) {
      assert.throws(() => parsePublicHosts([bad], undefined), /개인 이름/, bad);
      assert.throws(() => parseArgs([], { KNOWLEDGE_VIEWER_PUBLIC_HOSTS: bad } as NodeJS.ProcessEnv), /개인 이름/, bad);
    }
    assert.throws(() => parseArgs(['--public-host'], env), /개인 이름/);
  });

  it('createViewerServer 도 같은 규칙으로 거부한다 — localhost 를 화면 출처로 만들지 않게', () => {
    const fx = makeGitFixture();
    try {
      assert.throws(
        () => createViewerServer({ root: fx.root, includePrivate: false, distDir: path.join(fx.root, 'no-dist'), watch: false, embeddings: false, log: () => {}, publicHosts: ['localhost'] }),
        /개인 이름/,
      );
    } finally {
      fx.cleanup();
    }
  });
});
