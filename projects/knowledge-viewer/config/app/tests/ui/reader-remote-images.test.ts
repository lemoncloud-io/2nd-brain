// 원격 이미지(⚙ "원격 이미지 보기" + 허용 호스트) — imageSrc 판정과 리더 SSR, ⚙ "이미지" 줄.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import type { DocResponse } from '../../src/app/types.ts';
import { moveImageSrcToTitle, remoteImageDecision, type ImageEnv } from '../../src/reader/imageSrc.ts';
import { createRemoteImageStore, type RemoteImageView } from '../../src/reader/remote-images.ts';

const { Reader } = await import('../../src/reader/Reader.tsx');
const { SettingsPanel } = await import('../../src/app/SettingsMenu.tsx');

const HOSTS = ['image.lemoncloud.io', 'file.eureka.codes'];
const ON: RemoteImageView = { enabled: true, hosts: HOSTS };
const OFF: RemoteImageView = { enabled: false, hosts: HOSTS };
const env = (remote: RemoteImageView | undefined, agent = false): ImageEnv => ({ agent, docPath: 'raw/doc.md', links: [], gitOrigin: 'http://localhost:8779', remote });

// ── 판정(순수) ─────────────────────────────────────────────────────────
test('remoteImageDecision: 끔·env 없음·에이전트는 배지, 켬이면 허용은 show·그 밖은 ask', () => {
  const a = 'https://image.lemoncloud.io/abc';
  const m = 'https://miro.medium.com/v2/a.png';
  assert.deepEqual(remoteImageDecision(a, undefined), { kind: 'badge' });
  assert.deepEqual(remoteImageDecision(a, env(undefined)), { kind: 'badge' });
  assert.deepEqual(remoteImageDecision(a, env(OFF)), { kind: 'badge' });
  assert.deepEqual(remoteImageDecision(a, env(ON, true)), { kind: 'badge' });
  assert.deepEqual(remoteImageDecision(a, env(ON)), { kind: 'show', href: a });
  assert.deepEqual(remoteImageDecision(m, env(ON)), { kind: 'ask', href: m });
  assert.deepEqual(remoteImageDecision(m, env({ enabled: true, hosts: [...HOSTS, 'miro.medium.com'] })), { kind: 'show', href: m });
});

test('remoteImageDecision: http·//host 는 허용 호스트여도 배지(https 만)', () => {
  for (const s of ['http://image.lemoncloud.io/abc', '//image.lemoncloud.io/abc', 'https://image.lemoncloud.io@evil.test/a.png']) {
    assert.deepEqual(remoteImageDecision(s, env(ON)), { kind: 'badge' }, s);
  }
});

type El = { type: string; tagName: string; properties: Record<string, unknown>; children: never[] };
const run1 = (src: string, e: ImageEnv, extra: Record<string, unknown> = {}): Record<string, unknown> => {
  const tree = { type: 'root', children: [{ type: 'element', tagName: 'img', properties: { src, alt: 'a', ...extra }, children: [] } as El] };
  moveImageSrcToTitle(tree, e);
  return tree.children[0]!.properties;
};

test('moveImageSrcToTitle(remote): show 는 정규 주소 + lazy·async, ask 는 src 없이 data-remote-ask, 끔은 지금처럼', () => {
  assert.deepEqual(run1('https://image.lemoncloud.io/abc', env(ON)), {
    src: 'https://image.lemoncloud.io/abc',
    alt: 'a',
    title: 'https://image.lemoncloud.io/abc',
    loading: 'lazy',
    decoding: 'async',
  });
  assert.deepEqual(run1('https://miro.medium.com/a.png', env(ON)), { alt: 'a', title: 'https://miro.medium.com/a.png', dataRemoteAsk: 'https://miro.medium.com/a.png' });
  assert.deepEqual(run1('https://image.lemoncloud.io/abc', env(OFF)), { alt: 'a', title: 'https://image.lemoncloud.io/abc' });
  // 본문 HTML 이 적어 둔 data-remote-ask 는 지운다.
  assert.deepEqual(run1('./a.txt', env(ON), { dataRemoteAsk: 'https://evil.test/x.png' }), { alt: 'a', title: './a.txt' });
  assert.deepEqual(run1('https://image.lemoncloud.io/abc', env(OFF), { dataRemoteAsk: 'https://evil.test/x.png' }), {
    alt: 'a',
    title: 'https://image.lemoncloud.io/abc',
  });
});

// ── 리더 SSR ──────────────────────────────────────────────────────────
const doc = (body: string): DocResponse => ({
  source: 'local',
  head: null,
  path: 'raw/doc.md',
  title: 'doc',
  frontmatter: {},
  body,
  bodyStartLine: 1,
  headings: [],
  links: [],
  backlinks: [],
  stamp: { commit: null, dirty: false },
  mtime: 0,
  ignored: false,
});
const BODY = '![a](https://image.lemoncloud.io/abc)\n\n![m](https://miro.medium.com/v2/a.png)\n\n![h](http://image.lemoncloud.io/x.png)';
const render = (remoteImages: RemoteImageView | undefined, agent = false, body = BODY): string =>
  renderToStaticMarkup(createElement(Reader, { doc: doc(body), agent, onNavigate: () => {}, remoteImages }));

test('Reader: 토글 끔(기본·SSR)이면 원격은 전부 배지 — <img> 도 불러오기도 없다', () => {
  for (const html of [render(OFF), render(undefined)]) {
    assert.ok(!html.includes('<img'), html);
    assert.ok(!html.includes('img-load'), html);
    assert.match(html, /<a class="img-badge-link" href="https:\/\/image.lemoncloud.io\/abc" target="_blank" rel="noreferrer"><span class="img-badge" title="a">이미지: https:\/\/image.lemoncloud.io\/abc<\/span><\/a>/);
  }
});

test('Reader: 켬 + 허용 호스트는 <img> (lazy·no-referrer), 비허용은 배지 + 불러오기, http 는 배지만', () => {
  const html = render(ON);
  assert.match(
    html,
    /<a class="img-open" href="https:\/\/image.lemoncloud.io\/abc" target="_blank" rel="noreferrer"><img src="https:\/\/image.lemoncloud.io\/abc" alt="a" title="https:\/\/image.lemoncloud.io\/abc" loading="lazy" decoding="async" referrerPolicy="no-referrer"\/><\/a>/,
  );
  assert.match(
    html,
    /<span class="img-remote"><a class="img-badge-link" href="https:\/\/miro.medium.com\/v2\/a.png"[^>]*><span class="img-badge" title="m">이미지: https:\/\/miro.medium.com\/v2\/a.png<\/span><\/a><button type="button" class="img-load"[^>]*>불러오기<\/button><\/span>/,
  );
  assert.ok(!html.includes('src="https://miro.medium.com'), html);
  assert.ok(!html.includes('src="http://image.lemoncloud.io'), html);
  assert.equal((html.match(/<img /g) ?? []).length, 1);
  assert.equal((html.match(/class="img-load"/g) ?? []).length, 1);
});

test('Reader: 링크 안 원격 이미지 — 허용은 <img> 만, 비허용은 배지 + 불러오기(링크를 겹치지 않는다)', () => {
  const html = render(ON, false, '[![a](https://image.lemoncloud.io/abc)](https://x.test)\n\n[![s](https://img.shields.io/b.svg)](https://x.test)');
  assert.match(html, /<a href="https:\/\/x.test"[^>]*><img src="https:\/\/image.lemoncloud.io\/abc"[^>]*referrerPolicy="no-referrer"\/><\/a>/);
  assert.match(html, /<span class="img-remote"><span class="img-badge" title="s">이미지: https:\/\/img.shields.io\/b.svg<\/span><button type="button" class="img-load"/);
  assert.ok(!html.includes('img-badge-link'), html);
});

test('Reader: 에이전트 모드는 토글과 무관하게 배지 그대로', () => {
  const html = render(ON, true);
  assert.ok(!html.includes('<img'), html);
  assert.ok(!html.includes('img-load'), html);
  assert.match(html, /이미지: https:\/\/image.lemoncloud.io\/abc/);
});

test('Reader: 본문 HTML <img src=https> 도 같은 규칙 — 끔이면 벗겨지고 켬+허용만 남는다', () => {
  const body = '<img src="https://image.lemoncloud.io/abc" alt="r"> <img src="https://evil.test/a.png" alt="e" data-remote-ask="javascript:alert(1)">';
  const off = render(OFF, false, body);
  assert.ok(!off.includes('<img'), off);
  const on = render(ON, false, body);
  assert.match(on, /<img src="https:\/\/image.lemoncloud.io\/abc" alt="r"/);
  assert.ok(!on.includes('evil.test/a.png" alt'), on);
  assert.ok(!on.includes('javascript:'), on);
  assert.match(on, /data-remote-ask|img-load/);
});

// ── ⚙ "이미지" 줄 ──────────────────────────────────────────────────────
const noop = () => {};
const fakeStore = (v: RemoteImageView) =>
  createRemoteImageStore({ readEnabled: () => v.enabled, readHosts: () => [...v.hosts], writeEnabled: noop, writeHosts: noop }, { ssr: true });
const panel = (v: RemoteImageView) =>
  renderToStaticMarkup(
    createElement(SettingsPanel, {
      src: { kind: 'local' },
      prs: [],
      mainAvailable: true,
      onSourceChange: noop,
      fallbackReason: null,
      searchAll: false,
      onSearchAll: noop,
      leftOpen: true,
      rightOpen: true,
      onToggleLeft: noop,
      onToggleRight: noop,
      remoteImages: fakeStore(v),
    }),
  );

test('⚙ 설정: "이미지 | ☐ 원격 이미지 보기 · 허용 호스트…" 줄 — 끔이면 체크 없음, 켬이면 체크', () => {
  const off = panel(OFF);
  assert.match(off, /<span class="settings-h">이미지<\/span><div class="settings-cell settings-inline"><label class="settings-row"[^>]*><input type="checkbox"\/><span>원격 이미지 보기<\/span><\/label><button type="button" class="settings-link" aria-expanded="false">허용 호스트…<\/button><\/div>/);
  assert.ok(!off.includes('remote-hosts-input'), '편집 칸은 접혀 있다');
  assert.match(panel(ON), /<input type="checkbox" checked=""\/><span>원격 이미지 보기<\/span>/);
});

test('remote 저장소: 켜기·호스트·기본값 되돌리기가 쓰기와 알림을 거친다', () => {
  const writes: unknown[] = [];
  const store = createRemoteImageStore({
    readEnabled: () => false,
    readHosts: () => ['miro.medium.com'],
    writeEnabled: (on) => writes.push(['enabled', on]),
    writeHosts: (h) => writes.push(['hosts', [...h]]),
  });
  let n = 0;
  const off = store.subscribe(() => n++);
  assert.deepEqual(store.get(), { enabled: false, hosts: ['miro.medium.com'] });
  assert.deepEqual(store.getServer(), { enabled: false, hosts: HOSTS });
  store.setEnabled(true);
  store.setHosts(['a.test']);
  assert.deepEqual(store.get(), { enabled: true, hosts: ['a.test'] });
  store.resetHosts();
  assert.deepEqual(store.get().hosts, HOSTS);
  assert.deepEqual(writes, [['enabled', true], ['hosts', ['a.test']], ['hosts', HOSTS]]);
  assert.equal(n, 3);
  off();
});
