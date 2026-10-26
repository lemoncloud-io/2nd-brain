// /api 의 src 매개변수 — local(기본)·main·pr:<n>. 디스크·master·PR 세 상태가 서로 달라야 섞임이 드러난다.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { git } from '../../server/git.ts';
import { createViewerServer } from '../../server/main.ts';
import type { GhRunner } from '../../server/panels/prs.ts';
import { SourceManager } from '../../server/source.ts';
import { DISK_LINE, makeGitFixture, type GitFixture } from '../helpers/git-fixture.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PR_ALPHA = '---\ntype: concept\n---\n\n# 알파(PR)\n\nPR 에서 고친 알파다. [[new]] 를 본다.\n';
const NEW_MD = '# 새 문서\n\nPR 이 더한 문서다.\n';

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

describe('HTTP 서버 — 소스(src)', () => {
  let fx: GitFixture;
  let distTmp: string;
  let server: http.Server;
  let base: string;
  let masterAlpha: string;

  before(async () => {
    fx = makeGitFixture();
    masterAlpha = fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'vault', 'wiki', 'alpha.md'), 'utf8');
    fx.openPr(1, 'master', { 'wiki/alpha.md': PR_ALPHA, 'wiki/new.md': NEW_MD }, 'PR 1');
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

  const get = async (p: string): Promise<{ status: number; json: Json }> => {
    const res = await fetch(base + p);
    return { status: res.status, json: (await res.json()) as Json };
  };

  it('src 가 없으면 디스크(local)를 읽는다', async () => {
    const { status, json } = await get('/api/doc?path=wiki/alpha.md');
    assert.equal(status, 200);
    assert.ok((json.body as string).includes(DISK_LINE));
    assert.equal(json.source, 'local');
    assert.match(json.head ?? '', /^[0-9a-f]{4,}$/);
    assert.equal(typeof json.mtime, 'number');
    assert.notEqual(json.mtime, 0);
  });

  it('src=main 은 origin/master 내용이다', async () => {
    const { status, json } = await get('/api/doc?path=wiki/alpha.md&src=main');
    assert.equal(status, 200);
    assert.equal(json.source, 'main');
    assert.ok(masterAlpha.endsWith(json.body as string));
    assert.ok(!(json.body as string).includes(DISK_LINE));
    assert.equal(json.title, '알파');
    assert.match(json.head ?? '', /^[0-9a-f]{4,}$/);
    assert.deepEqual(json.stamp, { commit: json.head, dirty: false });
    assert.equal(json.mtime, 0);
    assert.equal(json.ignored, false);
  });

  it('src=pr:1 은 PR 내용이고 [[new]] 가 PR 파일 집합으로 풀린다', async () => {
    const { status, json } = await get('/api/doc?path=wiki/alpha.md&src=pr:1');
    assert.equal(status, 200);
    assert.equal(json.source, 'pr:1');
    assert.equal(json.title, '알파(PR)');
    assert.ok((json.body as string).includes('PR 에서 고친 알파다'));
    const link = (json.links as Json[]).find((l) => l.target === 'new');
    assert.equal(link?.path, 'wiki/new.md');
    assert.equal(fs.existsSync(path.join(fx.root, 'wiki', 'new.md')), false);
    assert.ok(Array.isArray(json.backlinks));
  });

  it('/api/tree?src=pr:1 에 PR 이 더한 파일이 있고 제목이 붙는다', async () => {
    const pr = await get('/api/tree?dir=wiki&src=pr:1');
    assert.equal(pr.status, 200);
    const entry = (pr.json.entries as Json[]).find((e) => e.path === 'wiki/new.md');
    assert.equal(entry?.title, '새 문서');
    const local = await get('/api/tree?dir=wiki');
    assert.equal((local.json.entries as Json[]).some((e) => e.path === 'wiki/new.md'), false);
  });

  it('PR 에만 있는 문서는 local 404, src=pr:1 200', async () => {
    assert.equal((await get('/api/doc?path=wiki/new.md')).status, 404);
    const pr = await get('/api/doc?path=wiki/new.md&src=pr:1');
    assert.equal(pr.status, 200);
    assert.equal(pr.json.title, '새 문서');
  });

  it('/api/preview·/api/resolve 도 src 를 받는다', async () => {
    const pv = await get('/api/preview?path=wiki/new.md&src=pr:1');
    assert.equal(pv.status, 200);
    assert.equal(pv.json.excerpt, 'PR 이 더한 문서다.');
    assert.equal((await get('/api/preview?path=wiki/new.md')).status, 404);
    const rs = await get('/api/resolve?link=new&kind=wiki&from=wiki/alpha.md&src=pr:1');
    assert.equal(rs.status, 200);
    assert.equal(rs.json.path, 'wiki/new.md');
    const rl = await get('/api/resolve?link=new&kind=wiki&from=wiki/alpha.md');
    assert.equal(rl.status, 200);
    assert.notEqual(rl.json.path, 'wiki/new.md');
  });

  it('git 소스도 경로 검사를 먼저 한다', async () => {
    for (const src of ['main', 'pr:1']) {
      for (const q of ['../x.md', '/etc/x.md', 'private/p.md', 'PRIVATE/p.md', '.git/config.md', 'node_modules/x.md', 'wiki/a%00.md', 'wiki/none.md']) {
        assert.equal((await get(`/api/doc?path=${q}&src=${src}`)).status, 404, `doc ${q} ${src}`);
        assert.equal((await get(`/api/preview?path=${q}&src=${src}`)).status, 404, `preview ${q} ${src}`);
      }
      assert.equal((await get(`/api/doc?path=outputs/a.html&src=${src}`)).status, 400);
      for (const d of ['..', 'PRIVATE', 'private', 'wiki/..', 'node_modules', '.git', 'nope']) {
        assert.equal((await get(`/api/tree?dir=${d}&src=${src}`)).status, 404, `tree ${d} ${src}`);
      }
    }
  });

  it('거부할 경로는 소스를 열지 않는다(fetch·gh 없음)', async () => {
    const calls = { fetch: 0, gh: 0 };
    const spyGit: typeof git = (root, args, o) => {
      if (args[0] === 'fetch') calls.fetch += 1;
      return git(root, args, o);
    };
    const spyGh: GhRunner = (args, cwd) => {
      calls.gh += 1;
      return fx.gh(args, cwd);
    };
    const s2 = createViewerServer({
      root: fx.root,
      includePrivate: false,
      distDir: path.join(distTmp, 'dist'),
      watch: false,
      sources: new SourceManager(fx.root, { git: spyGit, gh: spyGh }),
      log: () => {},
    });
    const b2 = await listen(s2);
    try {
      for (const src of ['main', 'pr:1']) {
        assert.equal((await fetch(`${b2}/api/doc?path=../x.md&src=${src}`)).status, 404);
        assert.equal((await fetch(`${b2}/api/preview?path=PRIVATE/p.md&src=${src}`)).status, 404);
        assert.equal((await fetch(`${b2}/api/tree?dir=..&src=${src}`)).status, 404);
      }
      assert.deepEqual(calls, { fetch: 0, gh: 0 });
    } finally {
      await close(s2);
    }
  });

  it('includePrivate 서버에서도 git 소스의 private 경로는 소스를 열지 않는다(fetch·gh 없음)', async () => {
    const calls = { fetch: 0, gh: 0 };
    const spyGit: typeof git = (root, args, o) => {
      if (args[0] === 'fetch') calls.fetch += 1;
      return git(root, args, o);
    };
    const spyGh: GhRunner = (args, cwd) => {
      calls.gh += 1;
      return fx.gh(args, cwd);
    };
    const s3 = createViewerServer({
      root: fx.root,
      includePrivate: true,
      distDir: path.join(distTmp, 'dist'),
      watch: false,
      sources: new SourceManager(fx.root, { git: spyGit, gh: spyGh }),
      log: () => {},
    });
    const b3 = await listen(s3);
    try {
      for (const src of ['main', 'pr:1']) {
        assert.equal((await fetch(`${b3}/api/doc?path=private/p.md&src=${src}`)).status, 404, `doc ${src}`);
        assert.equal((await fetch(`${b3}/api/preview?path=private/p.md&src=${src}`)).status, 404, `preview ${src}`);
        assert.equal((await fetch(`${b3}/api/tree?dir=private&src=${src}`)).status, 404, `tree ${src}`);
      }
      assert.deepEqual(calls, { fetch: 0, gh: 0 });
      // 디스크(local)에선 그대로 보인다. 잘못된 src 는 여전히 400 이다.
      assert.equal((await fetch(`${b3}/api/doc?path=private/p.md`)).status, 200);
      assert.equal((await fetch(`${b3}/api/doc?path=private/p.md&src=zzz`)).status, 400);
    } finally {
      await close(s3);
    }
  });

  it('응답을 직렬화하지 못해도(순환 frontmatter) 500 이고 서버는 산다', async () => {
    fs.writeFileSync(path.join(fx.root, 'wiki', 'loop.md'), '---\na: &x\n  b: *x\n---\n\n# 순환\n');
    const bad = await get('/api/doc?path=wiki/loop.md');
    assert.equal(bad.status, 500);
    assert.deepEqual(bad.json, { error: '내부 오류' });
    assert.equal((await get('/api/tree?dir=')).status, 200);
    assert.equal((await get('/api/doc?path=wiki/alpha.md')).status, 200);
  });

  it('잘못된 src 는 400, 모르는 PR 은 503 + error', async () => {
    const bad = await get('/api/doc?path=wiki/alpha.md&src=zzz');
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, 'src 가 올바르지 않다');
    assert.equal((await get('/api/tree?dir=wiki&src=pr:x')).status, 400);
    const unknown = await get('/api/doc?path=wiki/alpha.md&src=pr:99');
    assert.equal(unknown.status, 503);
    assert.equal(typeof unknown.json.error, 'string');
    assert.notEqual(unknown.json.error, '');
  });

  // fetch 는 경로의 `..` 를 접어 버리므로 http.request 로 보낸다(경로가 그대로 간다).
  const asHost = (hostname: string, p: string, at = base): Promise<{ status: number; location?: string; headers: http.IncomingHttpHeaders; body: string }> =>
    new Promise((resolve, reject) => {
      const u = new URL(at);
      const req = http.request({ host: '127.0.0.1', port: u.port, path: p, headers: { Host: `${hostname}:${u.port}` } }, (r) => {
        let body = '';
        r.setEncoding('utf8');
        r.on('data', (c: string) => (body += c));
        r.on('end', () => resolve({ status: r.statusCode ?? 0, location: r.headers.location, headers: r.headers, body }));
      });
      req.on('error', reject);
      req.end();
    });

  describe('/raw 소스 접두', () => {
    it('/raw/@pr/1/<rel> 은 PR 내용이다', async () => {
      const r = await asHost('localhost', '/raw/@pr/1/wiki/new.md');
      assert.equal(r.status, 200);
      assert.equal(r.body, NEW_MD);
      assert.equal(r.headers['content-type'], 'text/markdown; charset=utf-8');
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
      assert.equal(r.headers['cache-control'], 'no-cache');
      assert.equal(r.headers['content-length'], String(Buffer.byteLength(NEW_MD)));
      // 디스크(접두 없음)에는 없다.
      assert.equal((await asHost('localhost', '/raw/wiki/new.md')).status, 404);
    });

    it('/raw/@main/<rel> 은 master 내용이다(디스크 수정이 섞이지 않는다)', async () => {
      const r = await asHost('localhost', '/raw/@main/wiki/alpha.md');
      assert.equal(r.status, 200);
      assert.equal(r.body, masterAlpha);
      assert.ok(!r.body.includes(DISK_LINE));
      const pr = await asHost('localhost', '/raw/@pr/1/wiki/alpha.md');
      assert.equal(pr.body, PR_ALPHA);
    });

    it('/raw/@pr/1/*.html 은 두 호스트 모두 접두를 지킨 채 git 포트 localhost 로 302(git 서버를 열지 않았으면 주 포트 + 1)', async () => {
      const port = Number(new URL(base).port);
      for (const h of ['127.0.0.1', 'localhost']) {
        const r = await asHost(h, '/raw/@pr/1/outputs/a.html');
        assert.equal(r.status, 302, h);
        assert.equal(r.location, `http://localhost:${port + 1}/raw/@pr/1/outputs/a.html`, h);
      }
    });

    it('모르는 접두·없는 파일·잘못된 경로는 404', async () => {
      for (const p of ['/raw/@zzz/x', '/raw/@pr/x/wiki/new.md', '/raw/@pr/1', '/raw/@pr/1/', '/raw/@main', '/raw/@main/', '/raw/@pr/1/wiki/none.md', '/raw/@pr/1/../x', '/raw/@pr/1/wiki/%2e%2e/x', '/raw/@main/wiki', '/raw/@pr/1/%E0%A4%A']) {
        assert.equal((await asHost('localhost', p)).status, 404, p);
      }
    });

    it('`%40` 으로 시작하면 소스 접두가 아니라 디스크 경로다', async () => {
      const dir = path.join(fx.root, '@main');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'disk.md'), '디스크의 @main 폴더\n');
      try {
        const r = await asHost('localhost', '/raw/%40main/disk.md');
        assert.equal(r.status, 200);
        assert.equal(r.body, '디스크의 @main 폴더\n');
        assert.equal((await asHost('localhost', '/raw/@main/disk.md')).status, 404);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('모르는 PR 은 503', async () => {
      assert.equal((await asHost('localhost', '/raw/@pr/99/wiki/alpha.md')).status, 503);
    });
  });

  it('/raw 의 거부할 경로는 소스를 열지 않는다(fetch·gh 없음)', async () => {
    const calls = { fetch: 0, gh: 0 };
    const spyGit: typeof git = (root, args, o) => {
      if (args[0] === 'fetch') calls.fetch += 1;
      return git(root, args, o);
    };
    const spyGh: GhRunner = (args, cwd) => {
      calls.gh += 1;
      return fx.gh(args, cwd);
    };
    const s4 = createViewerServer({
      root: fx.root,
      includePrivate: true,
      distDir: path.join(distTmp, 'dist'),
      watch: false,
      sources: new SourceManager(fx.root, { git: spyGit, gh: spyGh }),
      log: () => {},
    });
    const b4 = await listen(s4);
    try {
      for (const pre of ['@main', '@pr/1']) {
        // 서버의 URL 파싱이 날 `..` 조각을 접으므로, 부호화한 `/`(%2F)로 `..` 를 경로 검사까지 보낸다.
        for (const rel of ['private/x.md', 'PRIVATE/x.md', 'Private%2Fx.md', '../x', 'wiki%2F..%2Fx', '.git/config', 'node_modules/x', 'wiki//x']) {
          assert.equal((await asHost('localhost', `/raw/${pre}/${rel}`, b4)).status, 404, `${pre}/${rel}`);
        }
      }
      assert.equal((await asHost('localhost', '/raw/@zzz/x', b4)).status, 404);
      assert.deepEqual(calls, { fetch: 0, gh: 0 });
    } finally {
      await close(s4);
    }
  });

  it('/api/info 에 sources 가 있다', async () => {
    const { status, json } = await get('/api/info');
    assert.equal(status, 200);
    assert.equal(json.sources.main.available, true);
    assert.match(json.sources.main.head ?? '', /^[0-9a-f]{4,}$/);
    assert.equal(json.sources.local.available, true);
    assert.match(json.sources.local.head ?? '', /^[0-9a-f]{4,}$/);
  });
});
