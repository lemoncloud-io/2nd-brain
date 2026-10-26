import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { VaultIndex } from '../../server/index-store.ts';
import { createViewerServer } from '../../server/main.ts';
import { makeFixtureVault } from '../helpers/fixture.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

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

describe('HTTP 서버', () => {
  let fx: ReturnType<typeof makeFixtureVault>;
  let distDir: string;
  let distTmp: string;
  let server: http.Server;
  let base: string;

  beforeEach(async () => {
    fx = makeFixtureVault();
    distTmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kv-dist-'));
    distDir = path.join(distTmp, 'dist'); // 없는 상태로 시작한다
    server = createViewerServer({ root: fx.root, includePrivate: false, distDir });
    base = await listen(server);
  });
  afterEach(async () => {
    await close(server);
    fx.cleanup();
    fs.rmSync(distTmp, { recursive: true, force: true });
  });

  const get = async (p: string): Promise<{ res: Response; json: Json }> => {
    const res = await fetch(base + p);
    const text = await res.text();
    let json: Json = {};
    try {
      json = JSON.parse(text) as Json;
    } catch {
      json = { _text: text };
    }
    return { res, json };
  };

  it('/api: 다른 Origin 은 403, Origin 없음·같은 Origin 은 200', async () => {
    const cross = await fetch(`${base}/api/tree?dir=`, { headers: { Origin: 'http://localhost:9' } });
    assert.equal(cross.status, 403);
    assert.deepEqual(await cross.json(), { error: 'cross-origin' });
    assert.equal((await fetch(`${base}/api/tree?dir=`)).status, 200);
    const same = await fetch(`${base}/api/tree?dir=`, { headers: { Origin: base } });
    assert.equal(same.status, 200);
  });

  /** 127.0.0.1 로 접속하되 Host 머리를 바꿔 보낸다. */
  const asHost = (
    hostname: string,
    p: string,
    method = 'GET',
  ): Promise<{ status: number; location?: string; headers: http.IncomingHttpHeaders; body: string }> =>
    new Promise((resolve, reject) => {
      const u = new URL(base);
      const req = http.request(
        { host: '127.0.0.1', port: u.port, path: p, method, headers: { Host: `${hostname}:${u.port}` } },
        (r) => {
          let body = '';
          r.setEncoding('utf8');
          r.on('data', (c: string) => (body += c));
          r.on('end', () => resolve({ status: r.statusCode ?? 0, location: r.headers.location, headers: r.headers, body }));
        },
      );
      req.on('error', reject);
      req.end();
    });

  describe('호스트 분할', () => {

    it('Host localhost: /api 는 404', async () => {
      assert.equal((await asHost('localhost', '/api/tree?dir=')).status, 404);
    });

    it('Host localhost: /v/* 는 127.0.0.1 로 302', async () => {
      const r = await asHost('localhost', '/v/wiki/alpha.md');
      assert.equal(r.status, 302);
      assert.equal(r.location, `${base}/v/wiki/alpha.md`);
    });

    it('Host localhost: /raw/* 는 그대로 200', async () => {
      assert.equal((await asHost('localhost', '/raw/wiki/alpha.md')).status, 200);
    });

    it('Host 가 루프백 이름이 아니면 /raw 도 404', async () => {
      const r = await asHost('evil.example', '/raw/wiki/alpha.md');
      assert.equal(r.status, 404);
      assert.equal(r.headers['access-control-allow-origin'], undefined);
    });

    it('Host 127.0.0.1: /raw 의 html·svg·xml 은 localhost 로 302, md 는 200', async () => {
      const port = new URL(base).port;
      const r = await asHost('127.0.0.1', '/raw/outputs/a.html');
      assert.equal(r.status, 302);
      assert.equal(r.location, `http://localhost:${port}/raw/outputs/a.html`);
      const q = await asHost('127.0.0.1', '/raw/outputs/a.html?x=1');
      assert.equal(q.location, `http://localhost:${port}/raw/outputs/a.html?x=1`);
      for (const p of ['/raw/x.svg', '/raw/x.XHTML', '/raw/x.xml', '/raw/x.htm', '/raw/outputs/a.htm%6C']) {
        assert.equal((await asHost('127.0.0.1', p)).status, 302, p);
      }
      assert.equal((await asHost('127.0.0.1', '/raw/wiki/alpha.md')).status, 200);
    });

    it('Host 127.0.0.1: /api 는 200', async () => {
      assert.equal((await asHost('127.0.0.1', '/api/tree?dir=')).status, 200);
    });
  });

  it('/api/tree: 루트에는 공개 폴더만 있다', async () => {
    const { res, json } = await get('/api/tree?dir=');
    assert.equal(res.status, 200);
    const names = (json.entries as Json[]).map((e) => e.name);
    for (const n of ['wiki', 'projects', 'raw', 'outputs']) assert.ok(names.includes(n), n);
    for (const n of ['private', 'node_modules', 'dist']) assert.ok(!names.includes(n), n);
  });

  it('/api/tree: md는 title을 갖고 ignored가 표시된다', async () => {
    const { json } = await get('/api/tree?dir=outputs');
    const local = (json.entries as Json[]).find((e) => e.name === 'local.md');
    assert.equal(local?.ignored, true);
    const wiki = (await get('/api/tree?dir=wiki')).json;
    const alpha = (wiki.entries as Json[]).find((e) => e.name === 'alpha.md');
    assert.equal(alpha?.title, '알파');
    assert.equal(wiki.dir, 'wiki');
  });

  it('/api/tree: 제외·private·없는 폴더는 404', async () => {
    assert.equal((await get('/api/tree?dir=private')).res.status, 404);
    assert.equal((await get('/api/tree?dir=node_modules')).res.status, 404);
    assert.equal((await get('/api/tree?dir=nope')).res.status, 404);
    assert.equal((await get('/api/tree?dir=../x')).res.status, 404);
  });

  it('/api/search: 질의는 hits, 빈 질의는 빈 목록, scope=all은 raw도', async () => {
    const { res, json } = await get('/api/search?q=beta');
    assert.equal(res.status, 200);
    assert.equal(json.scope, 'lint');
    const paths = (json.hits as Json[]).map((h) => h.path);
    assert.ok(paths.includes('wiki/beta.md'));
    assert.ok(!paths.includes('raw/beta.md'));
    const all = (await get('/api/search?q=beta&scope=all')).json;
    assert.equal(all.scope, 'all');
    assert.ok((all.hits as Json[]).some((h) => h.path === 'raw/beta.md'));
    const empty = await get('/api/search?q=');
    assert.equal(empty.res.status, 200);
    assert.deepEqual(empty.json, { q: '', scope: 'lint', hits: [] });
  });

  it('/api/doc: 제목·링크 해석·역링크·헤딩', async () => {
    const { res, json } = await get('/api/doc?path=wiki/alpha.md');
    assert.equal(res.status, 200);
    assert.equal(json.title, '알파');
    const beta = (json.links as Json[]).find((l) => l.target === 'beta');
    assert.equal(beta?.path, 'wiki/beta.md');
    assert.equal(json.headings[0].slug, '알파');
    assert.equal(json.headings[0].line, 6); // frontmatter 4줄 + 빈 줄 → 원문 6번째 줄
    assert.equal(json.ignored, false);
    assert.equal(typeof json.mtime, 'number');
    assert.equal(json.frontmatter.type, 'concept');
    assert.equal(json.stamp.dirty, true); // add만 하고 커밋 전
    const b = await get('/api/doc?path=wiki/beta.md');
    assert.ok((b.json.backlinks as Json[]).length > 0);
  });

  it('/api/doc: raw/ 문서는 200이고 backlinks는 비어 있다', async () => {
    const { res, json } = await get('/api/doc?path=raw/src.md');
    assert.equal(res.status, 200);
    assert.deepEqual(json.backlinks, []);
  });

  it('/api/doc: ignored 파일', async () => {
    const { res, json } = await get('/api/doc?path=outputs/local.md');
    assert.equal(res.status, 200);
    assert.equal(json.ignored, true);
  });

  it('/api/doc: private는 includePrivate일 때만', async () => {
    assert.equal((await get('/api/doc?path=private/p.md')).res.status, 404);
    const s2 = createViewerServer({ root: fx.root, includePrivate: true, distDir });
    const b2 = await listen(s2);
    try {
      const res = await fetch(`${b2}/api/doc?path=private/p.md`);
      assert.equal(res.status, 200);
    } finally {
      await close(s2);
    }
  });

  it('/api/doc: 경로 탈출은 404', async () => {
    for (const q of ['../VAULT_RULES.md', '/etc/passwd', '%2e%2e/x', 'wiki/../../x.md', 'node_modules/x.md', 'wiki/./alpha.md', '']) {
      const { res } = await get(`/api/doc?path=${q}`);
      assert.equal(res.status, 404, q);
    }
    assert.equal((await get('/api/doc')).res.status, 404);
  });

  it('/api/doc: md가 아니면 400, 없는 파일은 404', async () => {
    assert.equal((await get('/api/doc?path=outputs/a.html')).res.status, 400);
    assert.equal((await get('/api/doc?path=wiki/none.md')).res.status, 404);
    assert.equal((await get('/api/doc?path=wiki.md')).res.status, 404);
  });

  it('공백·한글 경로', async () => {
    const raw = await fetch(`${base}/raw/raw/%ED%95%9C%EA%B8%80%20%ED%8C%8C%EC%9D%BC.md`);
    assert.equal(raw.status, 200);
    assert.ok((raw.headers.get('content-type') ?? '').startsWith('text/markdown'));
    const doc = await get('/api/doc?path=raw%2F%ED%95%9C%EA%B8%80%20%ED%8C%8C%EC%9D%BC.md');
    assert.equal(doc.res.status, 200);
  });

  it('/raw: html 헤더·탈출·폴더', async () => {
    const r = await asHost('localhost', '/raw/outputs/a.html');
    assert.equal(r.status, 200);
    assert.ok(String(r.headers['content-type'] ?? '').startsWith('text/html'));
    assert.equal(r.headers['access-control-allow-origin'], undefined);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    const md = await fetch(`${base}/raw/wiki/alpha.md`);
    assert.equal(md.headers.get('access-control-allow-origin'), null);
    assert.equal(md.headers.get('x-content-type-options'), 'nosniff');
    await md.arrayBuffer();
    assert.equal((await fetch(`${base}/raw/../package.json`)).status, 404);
    assert.equal((await fetch(`${base}/raw/%2e%2e/package.json`)).status, 404);
    assert.equal((await fetch(`${base}/raw/wiki`)).status, 404);
    assert.equal((await fetch(`${base}/raw/private/p.md`)).status, 404);
    assert.equal((await fetch(`${base}/raw/node_modules/x.md`)).status, 404);
    assert.equal((await fetch(`${base}/raw/none.md`)).status, 404);
  });

  it('/raw: HEAD는 본문 없이 헤더만, POST는 405', async () => {
    const h = await asHost('localhost', '/raw/outputs/a.html', 'HEAD');
    assert.equal(h.status, 200);
    assert.equal(h.body, '');
    const p = await fetch(`${base}/api/tree`, { method: 'POST' });
    assert.equal(p.status, 405);
    await p.arrayBuffer();
  });

  it('/api/preview: 앵커가 있으면 그 헤딩 아래 문단', async () => {
    const { res, json } = await get('/api/preview?path=wiki/beta.md&anchor=둘째');
    assert.equal(res.status, 200);
    assert.equal(json.excerpt, '둘째 절이다.');
    assert.equal(json.type, 'concept');
    assert.equal(json.status, null);
    assert.equal(json.title, '베타');
    const noAnchor = await get('/api/preview?path=wiki/beta.md');
    assert.equal(noAnchor.json.excerpt, '본문이다.');
  });

  it('/api/preview: 600자로 자르고 코드 펜스는 건너뛴다', async () => {
    fs.writeFileSync(path.join(fx.root, 'wiki', 'long.md'), `# 긴 글\n\n\`\`\`\ncode\n\`\`\`\n\n${'가'.repeat(900)}\n`);
    const { json } = await get('/api/preview?path=wiki/long.md');
    assert.equal(json.excerpt.length, 600);
    assert.ok(!json.excerpt.includes('code'));
  });

  it('/api/resolve', async () => {
    const { res, json } = await get('/api/resolve?link=beta&kind=wiki&from=wiki/alpha.md');
    assert.equal(res.status, 200);
    assert.equal(json.path, 'wiki/beta.md');
    assert.ok(Array.isArray(json.candidates));
    assert.equal((await get('/api/resolve?link=beta&kind=nope&from=wiki/alpha.md')).res.status, 400);
  });

  it('깨진 frontmatter도 200이고 제목은 H1이다', async () => {
    fs.writeFileSync(path.join(fx.root, 'wiki', 'broken.md'), '---\ntitle: [깨짐\n  : :\n---\n\n# 깨진 문서\n\n본문.\n');
    const { res, json } = await get('/api/doc?path=wiki/broken.md');
    assert.equal(res.status, 200);
    assert.equal(json.title, '깨진 문서');
  });

  it('/api/graph: 기본값과 인자 검증', async () => {
    const ok = await get('/api/graph?center=wiki/alpha.md');
    assert.equal(ok.res.status, 200);
    assert.equal(ok.json.depth, 2);
    assert.equal(ok.json.hubThreshold, 50);
    assert.equal(ok.json.center, 'wiki/alpha.md');
    assert.equal((await get('/api/graph?center=wiki/alpha.md&depth=4')).res.status, 400);
    assert.equal((await get('/api/graph?center=wiki/alpha.md&depth=x')).res.status, 400);
    assert.equal((await get('/api/graph?center=wiki/alpha.md&hubs=all')).res.status, 400);
    assert.equal((await get('/api/graph?center=raw/beta.md')).res.status, 404);
    assert.equal((await get('/api/graph')).res.status, 400);
    assert.equal((await get('/api/graph?center=')).res.status, 400);
    const all = await get('/api/graph?all=1');
    assert.equal(all.res.status, 200);
    assert.equal(all.json.nodes.length, 6);
    assert.equal(all.json.center, null);
  });

  it('/api/graph: --graph-hub 문턱과 한글 경로 center·expand', async () => {
    const rel = 'wiki/한글 노트.md';
    fs.writeFileSync(path.join(fx.root, rel), '---\ntype: concept\n---\n\n# 한글\n\n[[alpha]]\n');
    const idx = new VaultIndex(fx.root);
    idx.build();
    const s2 = createViewerServer({ root: fx.root, includePrivate: false, distDir, index: idx, watch: false, graphHub: 3 });
    const b2 = await listen(s2);
    try {
      const r = await fetch(`${b2}/api/graph?center=wiki/alpha.md`);
      assert.equal(((await r.json()) as Json).hubThreshold, 3);
      const url = `${b2}/api/graph?center=wiki/%ED%95%9C%EA%B8%80%20%EB%85%B8%ED%8A%B8.md&expand=wiki%2Falpha.md`;
      const k = await fetch(url);
      assert.equal(k.status, 200);
      const body = (await k.json()) as Json;
      assert.equal(body.center, rel);
      assert.ok(body.nodes.some((n: Json) => n.path === 'wiki/beta.md'));
    } finally {
      await close(s2);
    }
  });

  it('알 수 없는 /api는 404 JSON', async () => {
    const { res, json } = await get('/api/nope');
    assert.equal(res.status, 404);
    assert.equal(typeof json.error, 'string');
  });

  it('/v/*는 빌드 전 503, 있으면 index.html', async () => {
    const before = await fetch(`${base}/v/wiki/alpha.md`);
    assert.equal(before.status, 503);
    assert.equal(await before.text(), '빌드 전 — npm run build');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>fake</title>');
    for (const p of ['/', '/v/wiki/alpha.md']) {
      const r = await fetch(base + p);
      assert.equal(r.status, 200);
      assert.ok((r.headers.get('content-type') ?? '').startsWith('text/html'));
      assert.equal(await r.text(), '<!doctype html><title>fake</title>');
    }
  });

  it('대소문자·심링크 우회는 404', async () => {
    for (const p of ['/raw/Private/p.md', '/raw/PRIVATE/p.md', '/raw/.GIT/config', '/raw/Node_Modules/x.md', '/raw/..%2Fpackage.json']) {
      assert.equal((await fetch(base + p)).status, 404, p);
    }
    assert.equal((await get('/api/doc?path=PRIVATE/p.md')).res.status, 404);
    assert.equal((await get('/api/tree?dir=Private')).res.status, 404);
    assert.equal((await get('/api/tree?dir=NODE_MODULES')).res.status, 404);
    fs.symlinkSync('../private/p.md', path.join(fx.root, 'wiki', 'link.md'));
    assert.equal((await fetch(`${base}/raw/wiki/link.md`)).status, 404);
    assert.equal((await get('/api/doc?path=wiki/link.md')).res.status, 404);
    assert.equal((await get('/api/preview?path=wiki/link.md')).res.status, 404);
    // 일반 파일은 그대로 열린다
    assert.equal((await fetch(`${base}/raw/wiki/alpha.md`)).status, 200);
  });

  it('/api/tree: 점으로 시작하는 항목은 숨긴다', async () => {
    fs.mkdirSync(path.join(fx.root, 'wiki', '.hidden'));
    fs.writeFileSync(path.join(fx.root, 'wiki', '.dotfile'), 'x');
    fs.writeFileSync(path.join(fx.root, 'wiki', 'shown.md'), '# 보임\n');
    const names = ((await get('/api/tree?dir=wiki')).json.entries as Json[]).map((e) => e.name);
    assert.ok(names.includes('shown.md'));
    assert.ok(!names.includes('.hidden') && !names.includes('.dotfile'));
  });

  it('/api/*의 405는 JSON이고 오류 메시지에 절대경로가 없다', async () => {
    const r = await fetch(`${base}/api/doc`, { method: 'POST' });
    assert.equal(r.status, 405);
    assert.equal(typeof ((await r.json()) as Json).error, 'string');
    const t = await get('/api/tree?dir=nope');
    assert.ok(!JSON.stringify(t.json).includes(fx.root));
  });

  it('/raw: 클라이언트가 끊으면 읽기 스트림(fd)이 닫힌다', async (t) => {
    // 이 프로세스가 big.bin을 열어 두고 있는지 lsof로 센다(fd 총수는 소켓 때문에 흔들려 쓰지 않는다).
    const openBig = (): number => {
      const out = spawnSync('lsof', ['-p', String(process.pid), '-Fn'], { encoding: 'utf8' });
      if (out.error) return -1;
      return out.stdout.split('\n').filter((l) => l.startsWith('n') && l.endsWith('big.bin')).length;
    };
    if (openBig() < 0) return t.skip('lsof가 없다');
    fs.writeFileSync(path.join(fx.root, 'outputs', 'big.bin'), Buffer.alloc(64 * 1024 * 1024, 1));
    const ac = new AbortController();
    const res = await fetch(`${base}/raw/outputs/big.bin`, { signal: ac.signal });
    const reader = res.body!.getReader();
    await reader.read(); // 첫 조각
    assert.equal(openBig(), 1, '읽는 중에는 파일이 열려 있다');
    ac.abort();
    await reader.read().catch(() => undefined);
    const deadline = Date.now() + 1000;
    while (openBig() > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    assert.equal(openBig(), 0, '끊은 뒤에도 파일이 열려 있다');
  });
});
