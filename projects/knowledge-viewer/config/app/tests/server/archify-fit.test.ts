// archify 틀 맞춤 주입(server/archify-fit.ts) — 넣는 자리, 옵트인 조건(html + kv-fit=1), 디스크·git 포트 /raw 응답,
// 그리고 주입 스크립트의 메시지 검사(보낸 창·꼴·첫 출처)와 높이 알림.
import { after, before, describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import type { AddressInfo } from 'node:net';

import { FIT_SNIPPET, FIT_VIEWPORT_HEIGHT, fitRawBytes, injectArchifyFit } from '../../server/archify-fit.ts';
import { createViewerServer, type ViewerServer } from '../../server/main.ts';
import { SourceManager } from '../../server/source.ts';
import { ARCHIFY_FRAME_MAX_HEIGHT, FIT_HEIGHT, FIT_READY, FIT_SETTINGS } from '../../shared/archify-fit.ts';
import { makeGitFixture, type GitFixture } from '../helpers/git-fixture.ts';

test('injectArchifyFit: <head> 바로 뒤, 없으면 <html>·doctype 뒤, 그것도 없으면 맨 앞', () => {
  const withHead = '<!DOCTYPE html>\n<html lang="ko"><head>\n<script>var a=1</script></head><body></body></html>';
  const out = injectArchifyFit(withHead);
  assert.ok(out.startsWith('<!DOCTYPE html>\n<html lang="ko"><head>\n' + FIT_SNIPPET));
  assert.ok(out.indexOf('data-kv-fit') < out.indexOf('var a=1'), '원래 첫 스크립트보다 먼저');
  assert.ok(injectArchifyFit('<HEAD data-x="1"><p>').startsWith('<HEAD data-x="1">\n' + FIT_SNIPPET));
  assert.ok(injectArchifyFit('<!doctype html><html><body>').startsWith('<!doctype html><html>\n' + FIT_SNIPPET));
  assert.ok(injectArchifyFit('<!doctype html><p>x').startsWith('<!doctype html>\n' + FIT_SNIPPET));
  assert.ok(injectArchifyFit('<p>x</p>').startsWith(FIT_SNIPPET));
  // <header> 는 <head> 가 아니다.
  assert.ok(injectArchifyFit('<!doctype html><html><body><header>').startsWith('<!doctype html><html>\n'));
});

test('fitRawBytes: html 이고 kv-fit=1 일 때만 고친다', () => {
  const html = Buffer.from('<html><head></head></html>');
  assert.equal(fitRawBytes('a.html', '', html), null);
  assert.equal(fitRawBytes('a.html', '?kv-fit=0', html), null);
  assert.equal(fitRawBytes('a.md', '?kv-fit=1', html), null);
  assert.equal(fitRawBytes('a.svg', '?kv-fit=1', html), null);
  assert.match(fitRawBytes('a.HTM', '?theme=dark&kv-fit=1', html)!.toString('utf8'), /data-kv-fit/);
});

/** 주입 스크립트만 꺼내 가짜 창에서 돌린다. 부모·메시지·body 높이를 시험이 정한다. */
function runFitScript(bodyHeight: () => number) {
  const script = /<script data-kv-fit>\n([\s\S]*?)\n<\/script>/.exec(FIT_SNIPPET)![1]!;
  const attrs = new Map<string, string>();
  const vars = new Map<string, string>();
  const posted: { data: unknown; target: string }[] = [];
  const handlers = new Map<string, ((e: unknown) => void)[]>();
  // vm 안의 객체는 다른 realm 이라 JSON 으로 옮겨 비교한다.
  const parent = { postMessage: (data: unknown, target: string) => posted.push({ data: JSON.parse(JSON.stringify(data)) as unknown, target }) };
  const ctx: Record<string, unknown> = {
    parent,
    innerWidth: 900,
    innerHeight: 600,
    Date,
    console: { warn: () => {} },
    // 바로 돌린다.
    requestAnimationFrame: (fn: () => void) => {
      fn();
      return 1;
    },
    // 타이머 대비책은 rAF 가 이미 잰 뒤라 아무것도 하지 않아야 한다 — 그대로 돌려 두 번 재지 않는지도 본다.
    setTimeout: (fn: () => void) => {
      fn();
      return 1;
    },
    getComputedStyle: () => ({ marginTop: '0px', marginBottom: '0px' }),
    addEventListener: (type: string, fn: (e: unknown) => void) => handlers.set(type, [...(handlers.get(type) ?? []), fn]),
    document: {
      documentElement: {
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        removeAttribute: (k: string) => attrs.delete(k),
        style: { setProperty: (k: string, v: string) => vars.set(k, v), removeProperty: (k: string) => vars.delete(k) },
      },
      body: { getBoundingClientRect: () => ({ height: bodyHeight() }) },
      addEventListener: () => {},
    },
  };
  ctx['window'] = ctx;
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  const dispatch = (type: string, e: unknown): void => (handlers.get(type) ?? []).forEach((fn) => fn(e));
  return { ctx, attrs, vars, posted, parent, dispatch };
}

test('주입 스크립트: ready 를 알리고, 창 높이를 고정값으로 보인다', () => {
  const f = runFitScript(() => 900);
  assert.deepEqual(f.posted, [{ data: { type: FIT_READY }, target: '*' }]);
  assert.equal(f.attrs.has('data-kv-fit'), true);
  assert.equal(f.attrs.has('data-kv-fit-linked'), false);
  assert.equal((f.ctx as { innerHeight: number }).innerHeight, FIT_VIEWPORT_HEIGHT);
});

test('주입 스크립트: 부모가 보낸 꼴 맞는 설정만 받고, 첫 출처로만 높이를 보낸다', () => {
  let h = 812.4;
  const f = runFitScript(() => h);
  const origin = 'http://127.0.0.1:8792';
  // 다른 창·꼴이 틀린 메시지는 버린다 — 연결도, 높이 알림도 없다.
  f.dispatch('message', { source: {}, origin, data: { type: FIT_SETTINGS, zoom: 130 } });
  f.dispatch('message', { source: f.parent, origin, data: { type: FIT_SETTINGS, zoom: 120 } });
  f.dispatch('message', { source: f.parent, origin, data: 'kv-archify:settings' });
  assert.equal(f.attrs.has('data-kv-fit-linked'), false);
  assert.equal(f.posted.length, 1);
  // 맞는 설정: 연결하고 배율을 적용하고 높이(올림)를 그 출처로 보낸다.
  f.dispatch('message', { source: f.parent, origin, data: { type: FIT_SETTINGS, zoom: 130 } });
  assert.equal(f.attrs.has('data-kv-fit-linked'), true);
  assert.equal(f.attrs.has('data-kv-zoom'), true);
  assert.equal(f.vars.get('--kv-zoom'), '1.3');
  assert.deepEqual(f.posted.at(-1), { data: { type: FIT_HEIGHT, height: 813 }, target: origin });
  // 다른 출처의 설정은 버린다(배율 그대로).
  f.dispatch('message', { source: f.parent, origin: 'http://evil.test', data: { type: FIT_SETTINGS, zoom: 100 } });
  assert.equal(f.vars.get('--kv-zoom'), '1.3');
  // 100 이면 배율 표지를 걷는다. 높이는 상한으로 묶는다.
  h = 10 ** 7;
  f.dispatch('message', { source: f.parent, origin, data: { type: FIT_SETTINGS, zoom: 100 } });
  assert.equal(f.attrs.has('data-kv-zoom'), false);
  assert.equal(f.vars.has('--kv-zoom'), false);
  assert.deepEqual(f.posted.at(-1), { data: { type: FIT_HEIGHT, height: ARCHIFY_FRAME_MAX_HEIGHT }, target: origin });
});

test('주입 스크립트: 높이만 바뀐 resize 는 archify 듣기에 넘기지 않는다', () => {
  const f = runFitScript(() => 700);
  let stopped = 0;
  f.dispatch('resize', { stopImmediatePropagation: () => (stopped += 1) });
  assert.equal(stopped, 1);
  (f.ctx as { innerWidth: number }).innerWidth = 1200;
  f.dispatch('resize', { stopImmediatePropagation: () => (stopped += 1) });
  assert.equal(stopped, 1, '폭이 바뀌면 넘긴다');
});

test('주입 스크립트: 같은 높이는 다시 알리지 않고, 진동하면 폭이 바뀔 때까지 멈춘다', () => {
  let h = 700;
  const f = runFitScript(() => h);
  const origin = 'http://127.0.0.1:1';
  f.dispatch('message', { source: f.parent, origin, data: { type: FIT_SETTINGS, zoom: 100 } });
  const n = f.posted.length;
  f.dispatch('load', {});
  assert.equal(f.posted.length, n, '같은 높이');
  for (let i = 0; i < 60; i++) {
    h = i % 2 === 0 ? 900 : 700;
    f.dispatch('load', {});
  }
  const heights = f.posted.filter((p) => (p.data as { type: string }).type === FIT_HEIGHT).length;
  assert.equal(heights, 40, '2초에 40번에서 멈춘다');
  // 폭이 바뀌면 다시 알린다.
  (f.ctx as { innerWidth: number }).innerWidth = 800;
  h = 1000;
  f.dispatch('resize', { stopImmediatePropagation: () => assert.fail('폭이 바뀐 resize 는 넘긴다') });
  assert.deepEqual(f.posted.at(-1), { data: { type: FIT_HEIGHT, height: 1000 }, target: origin });
});

const listen = (server: http.Server): Promise<number> =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));

/** localhost 호스트 머리로 보낸다. */
const asLocalhost = (port: number, p: string, method = 'GET'): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { Host: `localhost:${port}` } }, (r) => {
      let body = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => (body += c));
      r.on('end', () => resolve({ status: r.statusCode ?? 0, headers: r.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });

describe('/raw 응답의 맞춤 주입 — 디스크·git 포트', () => {
  let fx: GitFixture;
  let distTmp: string;
  let server: ViewerServer;
  let port: number;
  let gitPort: number;
  let original: string;

  before(async () => {
    fx = makeGitFixture();
    original = fs.readFileSync(path.join(fx.root, 'outputs', 'a.html'), 'utf8');
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
    port = await listen(server);
    gitPort = await listen(server.gitServer);
  });
  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    fx.cleanup();
    fs.rmSync(distTmp, { recursive: true, force: true });
  });

  it('디스크 html: 표지가 없으면 바이트 그대로, kv-fit=1 이면 주입하고 길이를 맞춘다', async () => {
    const plain = await asLocalhost(port, '/raw/outputs/a.html?theme=dark');
    assert.equal(plain.status, 200);
    assert.equal(plain.body, original);
    const fit = await asLocalhost(port, '/raw/outputs/a.html?theme=dark&kv-fit=1');
    assert.equal(fit.status, 200);
    assert.equal(fit.body, injectArchifyFit(original));
    assert.equal(fit.headers['content-length'], String(Buffer.byteLength(fit.body)));
    assert.equal(fit.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(fit.headers['x-content-type-options'], 'nosniff');
    const head = await asLocalhost(port, '/raw/outputs/a.html?kv-fit=1', 'HEAD');
    assert.equal(head.headers['content-length'], fit.headers['content-length']);
    assert.equal(head.body, '');
    // 원본 파일은 고치지 않는다.
    assert.equal(fs.readFileSync(path.join(fx.root, 'outputs', 'a.html'), 'utf8'), original);
  });

  it('디스크 md 는 표지가 있어도 그대로다', async () => {
    const md = await asLocalhost(port, '/raw/wiki/alpha.md?kv-fit=1');
    assert.equal(md.status, 200);
    assert.doesNotMatch(md.body, /data-kv-fit/);
  });

  it('git 포트 html(@main): 표지가 있을 때만 주입한다', async () => {
    const plain = await asLocalhost(gitPort, '/raw/@main/outputs/a.html');
    assert.equal(plain.status, 200);
    assert.doesNotMatch(plain.body, /data-kv-fit/);
    const fit = await asLocalhost(gitPort, '/raw/@main/outputs/a.html?kv-fit=1');
    assert.equal(fit.status, 200);
    assert.equal(fit.body, injectArchifyFit(plain.body));
    assert.equal(fit.headers['content-length'], String(Buffer.byteLength(fit.body)));
  });
});
