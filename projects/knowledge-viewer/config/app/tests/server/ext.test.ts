// 확장 층 계약: 폴더 찾기(KNOWLEDGE_VIEWER_EXT), 빌드·서버 확장 읽기와 모양 검사, 화면 확장 가상 모듈 풀이.
// 확장은 합성 폴더(임시 폴더)로만 만든다 — 볼트의 실제 ext/ 를 읽지 않는다.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DEFAULT_EXT_DIR, EMPTY_UI_FILE, EXT_ENV, EXT_UI_ID, extDir, extFile } from '../../ext-locate.ts';
import { EMPTY_BUILD_EXTENSION, assertBuildExtension, extVirtual, loadBuildExtension } from '../../ext-build.ts';
import { EMPTY_SERVER_EXTENSION, assertExtApi, assertServerExtension, loadServerExtension, type ExtApiRoute } from '../../server/ext.ts';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-ext-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** 합성 확장 폴더 하나를 만든다(파일 이름 → 내용). */
function makeExt(name: string, files: Record<string, string>): string {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"private":true,"type":"module"}\n');
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text);
  return dir;
}

const coreUrl = (rel: string): string => pathToFileURL(path.join(appDir, rel)).href;
const noop: ExtApiRoute['handle'] = async () => ({ status: 200, body: {} });

describe('확장 폴더 찾기', () => {
  it('off 면 확장 없음, 기본 폴더는 유닛 두 단계 위의 ext', () => {
    assert.equal(extDir({ [EXT_ENV]: 'off' }), null);
    assert.equal(extFile('ui.ts', { [EXT_ENV]: 'off' }), null);
    assert.equal(DEFAULT_EXT_DIR, path.resolve(appDir, '..', '..', 'ext'));
    assert.equal(EMPTY_UI_FILE, path.join(appDir, 'src', 'ext', 'empty.ts'));
  });

  it('환경 변수 경로를 쓰고, 그 폴더가 없으면 던진다', () => {
    const dir = makeExt('locate', { 'ui.ts': 'export default {};\n' });
    assert.equal(extDir({ [EXT_ENV]: dir }), dir);
    assert.equal(extFile('ui.ts', { [EXT_ENV]: dir }), path.join(dir, 'ui.ts'));
    assert.equal(extFile('server.ts', { [EXT_ENV]: dir }), null);
    assert.throws(() => extDir({ [EXT_ENV]: path.join(tmp, 'none') }), /확장 폴더가 없다/);
  });
});

describe('빌드 확장', () => {
  it('확장이 없으면 빈 값이다', async () => {
    assert.deepEqual(await loadBuildExtension({ [EXT_ENV]: 'off' }), EMPTY_BUILD_EXTENSION);
    const dir = makeExt('no-build', {});
    assert.deepEqual(await loadBuildExtension({ [EXT_ENV]: dir }), EMPTY_BUILD_EXTENSION);
  });

  it('build.ts 를 읽어 빈 칸을 채운다', async () => {
    const dir = makeExt('build', {
      'build.ts': `import { defineBuildExtension } from '${coreUrl('ext-build.ts')}';\nexport default defineBuildExtension({ appEmbeds: [{ id: 'demo-board', dir: '/x/demo/src' }], installDirs: ['/x/demo'] });\n`,
    });
    const ext = await loadBuildExtension({ [EXT_ENV]: dir });
    assert.deepEqual(ext, { appEmbeds: [{ id: 'demo-board', dir: '/x/demo/src' }], plugins: [], installDirs: ['/x/demo'], watch: [] });
  });

  it('깨진 build.ts 는 던진다(읽기 실패·모양 틀림)', async () => {
    const broken = makeExt('build-broken', { 'build.ts': 'export default ;\n' });
    await assert.rejects(loadBuildExtension({ [EXT_ENV]: broken }), /build\.ts 를 읽지 못했다/);
    assert.throws(() => assertBuildExtension(null), /객체가 아니다/);
    assert.throws(() => assertBuildExtension({ appEmbeds: [{ id: 'Bad', dir: '/x' }] }), /앱 id 가 올바르지 않다/);
    assert.throws(() => assertBuildExtension({ appEmbeds: [{ id: 'a', dir: '/x' }, { id: 'a', dir: '/y' }] }), /겹친다/);
    assert.throws(() => assertBuildExtension({ appEmbeds: [{ id: 'a', dir: 'rel' }] }), /절대경로가 아니다/);
    assert.throws(() => assertBuildExtension({ watch: ['rel'] }), /절대경로가 아니다/);
    assert.throws(() => assertBuildExtension({ plugins: {} }), /배열이 아니다/);
  });

  it('extVirtual 은 가상 id 를 확장 ui.ts 로, 없으면 빈 모듈로 풀고 확장 폴더 읽기를 허용한다', () => {
    const empty = extVirtual({ [EXT_ENV]: 'off' });
    assert.equal(empty.resolveId(EXT_UI_ID), EMPTY_UI_FILE);
    assert.equal(empty.resolveId('react'), null);
    assert.deepEqual(empty.config({ root: appDir }).server.fs.allow, [appDir]);
    const dir = makeExt('virtual', { 'ui.ts': 'export default {};\n' });
    const real = extVirtual({ [EXT_ENV]: dir });
    assert.equal(real.resolveId(EXT_UI_ID), path.join(dir, 'ui.ts'));
    assert.deepEqual(real.config({ root: appDir }).server.fs.allow, [appDir, dir]);
  });
});

describe('서버 확장', () => {
  const CORE = ['/api/tree', '/api/doc'];

  it('확장이 없으면 빈 값이다', async () => {
    assert.deepEqual(await loadServerExtension(CORE, { [EXT_ENV]: 'off' }), EMPTY_SERVER_EXTENSION);
  });

  it('server.ts 를 읽어 앱·API 를 낸다', async () => {
    const dir = makeExt('server', {
      'server.ts': `import { defineServerExtension } from '${coreUrl('server/ext.ts')}';\nexport default defineServerExtension({ apps: [{ id: 'demo-desk', title: '데모 데스크', server: async () => { throw new Error('x'); } }], api: [{ path: '/api/demo', handle: async () => ({ status: 200, body: { ok: true } }) }] });\n`,
    });
    const ext = await loadServerExtension(CORE, { [EXT_ENV]: dir });
    assert.deepEqual(ext.apps.map((a) => a.id), ['demo-desk']);
    assert.deepEqual(ext.api.map((r) => r.path), ['/api/demo']);
    assert.deepEqual(await ext.api[0]!.handle({ includePrivate: false, readSource: async () => ({ status: 400, body: {} }) }, new URL('http://x/api/demo')), { status: 200, body: { ok: true } });
  });

  it('깨진 server.ts 는 던진다', async () => {
    const broken = makeExt('server-broken', { 'server.ts': "import './none.ts';\nexport default {};\n" });
    await assert.rejects(loadServerExtension(CORE, { [EXT_ENV]: broken }), /server\.ts 를 읽지 못했다/);
    assert.throws(() => assertServerExtension({ apps: {} }, CORE), /배열이 아니다/);
    assert.throws(() => assertServerExtension({ apps: [{ id: 'A', title: 'a', server: async () => { throw new Error('x'); } }] }, CORE), /앱 id 가 올바르지 않다/);
  });

  it('확장 API 경로: 문법·코어 경로·코어 접두·중복을 거른다', () => {
    assert.doesNotThrow(() => assertExtApi([{ path: '/api/demo', handle: noop }, { path: '/api/demo/sub-1', handle: noop }], CORE));
    assert.throws(() => assertExtApi([{ path: '/api/Demo', handle: noop }], CORE), /올바르지 않다/);
    assert.throws(() => assertExtApi([{ path: '/demo', handle: noop }], CORE), /올바르지 않다/);
    assert.throws(() => assertExtApi([{ path: '/api/tree', handle: noop }], CORE), /코어와 겹친다/);
    assert.throws(() => assertExtApi([{ path: '/api/apps/demo', handle: noop }], CORE), /코어 접두/);
    assert.throws(() => assertExtApi([{ path: '/api/graph', handle: noop }], CORE), /코어 접두/);
    assert.throws(() => assertExtApi([{ path: '/api/demo', handle: noop }, { path: '/api/demo', handle: noop }], CORE), /겹친다/);
  });
});

describe('확장 /api 경로(서버)', () => {
  it('코어가 모르는 경로만 확장으로 간다: GET 은 확장 답, POST 는 405, 없는 경로 404, 확장은 소스를 읽는다', async () => {
    const { createViewerServer } = await import('../../server/main.ts');
    const { makeFixtureVault } = await import('../helpers/fixture.ts');
    const http = await import('node:http');
    const fx = makeFixtureVault();
    const seenSrc: string[] = [];
    const s = createViewerServer({
      root: fx.root,
      includePrivate: false,
      distDir: path.join(fx.root, 'no-dist'),
      watch: false,
      embeddings: false,
      log: () => {},
      extApi: [
        {
          path: '/api/demo',
          // 소스를 읽어 그 종류와 README 유무를 답한다.
          handle: async (ctx, url) => {
            const r = await ctx.readSource(url);
            if ('status' in r) return r;
            seenSrc.push(r.src.kind);
            return { status: 200, body: { kind: r.src.kind, readme: r.reader.exists('wiki/INDEX.md'), includePrivate: ctx.includePrivate } };
          },
        },
      ],
    });
    const port = await new Promise<number>((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as import('node:net').AddressInfo).port)));
    // 127.0.0.1 로 요청 하나를 보내고 상태·몸통을 받는다.
    const ask = (p: string, method = 'GET'): Promise<{ status: number; body: string }> =>
      new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { Origin: `http://127.0.0.1:${port}` } }, (r) => {
          let body = '';
          r.setEncoding('utf8');
          r.on('data', (c: string) => (body += c));
          r.on('end', () => resolve({ status: r.statusCode ?? 0, body }));
        });
        req.on('error', reject);
        req.end();
      });
    try {
      const ok = await ask('/api/demo?src=local');
      assert.equal(ok.status, 200);
      assert.deepEqual(JSON.parse(ok.body), { kind: 'local', readme: true, includePrivate: false });
      assert.equal((await ask('/api/demo?src=bad!')).status, 400);
      assert.equal((await ask('/api/demo', 'POST')).status, 405);
      assert.equal((await ask('/api/demo-none')).status, 404);
      assert.deepEqual(seenSrc, ['local']);
    } finally {
      await new Promise<void>((resolve) => {
        s.close(() => resolve());
        s.closeAllConnections();
      });
      fx.cleanup();
    }
  });

  it('createViewerServer 는 코어와 겹치는 확장 경로를 거부한다', async () => {
    const { createViewerServer } = await import('../../server/main.ts');
    assert.throws(
      () => createViewerServer({ root: tmp, includePrivate: false, distDir: tmp, watch: false, embeddings: false, log: () => {}, extApi: [{ path: '/api/tree', handle: noop }] }),
      /코어와 겹친다/,
    );
  });
});
