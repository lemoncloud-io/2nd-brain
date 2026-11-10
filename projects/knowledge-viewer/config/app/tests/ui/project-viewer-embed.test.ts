// viewer.yml 통합 보기: 셸 화면(ProjectViewer)을 이 앱의 host 로 SSR 해 본다 — 범위 클래스 아래에 그려지는지,
// 근거·원본 링크가 볼트 뷰어 주소(같은 소스)로 나가는지, 셸 라우트가 볼트 뷰어 주소의 해시로 왕복하는지.
// 데이터는 셸 시험 fixture(가상의 데모 프로젝트)를 셸 collect 로 묶은 것이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import { parseSource, type Source } from '../../shared/source.ts';
import { parseLocation } from '../../src/app/route.ts';
import { lineOfAnchor } from '../../src/reader/file-lines.ts';
import { isShellHash, shellHashOf, shellRouteHref, vaultEmbedHost } from '../../src/reader/project-viewer-host.ts';

const SHELL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../project-viewer/config/shell');
const MINI = path.join(SHELL, 'tests', 'fixtures', 'mini');
const SPEC = 'projects/demo/config/viewer.yml';

const { collect } = await import(path.join(SHELL, 'loader', 'collect.ts'));
const { makeReadFile } = await import(path.join(SHELL, 'loader', 'vault.ts'));
const { formatRoute, parseHash } = await import(path.join(SHELL, 'src', 'app', 'router.ts'));
const { ProjectViewer } = await import(path.join(SHELL, 'src', 'embed', 'ProjectViewer.tsx'));
type Route = import('../../../../../project-viewer/config/shell/src/app/router.ts').Route;

const BUNDLE = collect({
  projectDir: '',
  git: { commit: 'abcd1234', dirty: false },
  now: () => new Date('2026-10-28T00:00:00.000Z'),
  viewerText: fs.readFileSync(path.join(MINI, SPEC), 'utf8'),
  readFile: makeReadFile(MINI),
});

function render(hash: string, src: Source = { kind: 'local' }, theme: 'light' | 'dark' = 'dark'): string {
  const host = vaultEmbedHost({ agent: false, src, theme, onNavigate: () => {}, hash });
  return renderToStaticMarkup(createElement(ProjectViewer, { bundle: BUNDLE, host }));
}

test('셸 화면은 범위 클래스(.pv-root) 루트 아래에 그려지고, 밝기는 볼트 뷰어의 것이다', () => {
  const html = render('', { kind: 'local' }, 'dark');
  assert.match(html, /^<div class="pv-root pv-embed" data-theme="dark">/);
  assert.match(html, /class="topbar"/);
  assert.match(html, /데모 프로젝트 뷰어/);
  assert.match(render('', { kind: 'local' }, 'light'), /^<div class="pv-root pv-embed" data-theme="light">/);
  // 원시 HTML 주입이나 틀이 없다.
  assert.doesNotMatch(html, /<iframe|<script/);
});

test('셸 안의 화면 이동은 해시(#/…) 그대로, 근거 링크는 볼트 뷰어 문서 주소(같은 소스)로 나간다', () => {
  const pr = parseSource('pr:7')!;
  const html = render('#/p/P-arch/N-intake', pr);
  // 상단 메뉴: 셸 해시.
  assert.match(html, /class="topbar__link" href="#\/p\/P-arch"/);
  assert.match(html, /href="#\/glossary"/);
  // 근거 패널(항목 N-intake): 블록 근거(개요 › 구성 단위)가 볼트 뷰어 리더 주소다. 소스(pr:7)를 그대로 둔다.
  assert.match(html, /aria-label="근거"/);
  assert.match(html, /<a class="btn" href="\/v\/projects\/demo\/docs\/overview\.md\?src=pr:7#구성-단위">/);
  assert.doesNotMatch(html, /href="#\/docs\/overview/);
});

test('원본 목록(#/docs)은 셸 화면에 남고, 각 원본은 볼트 뷰어 문서로 간다', () => {
  const html = render('#/docs');
  assert.match(html, /class="doclist"/);
  assert.match(html, /href="\/v\/projects\/demo\/docs\/overview\.md\?src=local"/);
  assert.match(html, /href="\/v\/projects\/demo\/docs\/status\.yml\?src=local"/);
});

test('라우트 왕복: 셸 라우트 → 볼트 뷰어 주소 → (경로 = 스펙, 해시 = 셸 라우트), 줄 앵커와 겹치지 않는다', () => {
  const routes: Route[] = [
    { kind: 'home' },
    { kind: 'page', pageId: 'P-arch' },
    { kind: 'page', pageId: 'P-arch', itemId: 'N-intake' },
    { kind: 'page', pageId: '한글 페이지', itemId: 'a/b' },
    { kind: 'glossary' },
    { kind: 'glossary', termId: 'G-queue' },
    { kind: 'docs' },
    { kind: 'search', q: '대기열 재시도' },
  ];
  for (const src of [parseSource('local')!, parseSource('pr:7')!, parseSource('main')!]) {
    for (const route of routes) {
      const href = shellRouteHref(SPEC, formatRoute(route), false, src);
      const url = new URL(href, 'http://127.0.0.1:8790');
      const back = parseLocation(url.pathname, url.search, url.hash);
      assert.equal(back.path, SPEC, href);
      assert.equal(back.src.kind, src.kind, href);
      // 셸은 주소의 해시를 그대로(조각마다 푸는 셸 라우터로) 읽는다.
      assert.deepEqual(parseHash(shellHashOf(url.hash)), route, href);
      // 볼트 뷰어의 줄 앵커(`L12` → 원문 보기)로 읽히지 않는다.
      assert.equal(lineOfAnchor(back.anchor), null, href);
    }
  }
  // 볼트 뷰어의 다른 앵커는 셸 라우트가 아니다(셸 첫 화면).
  assert.equal(isShellHash('#L12'), false);
  assert.equal(shellHashOf('#검사-규칙'), '');
  assert.equal(shellRouteHref(SPEC, '', false, parseSource('local')!), `/v/${SPEC}?src=local`);
});

test('host: 원본 문서 주소는 볼트 뷰어 hrefFor(같은 소스·앵커), 열기는 navigate', () => {
  const opened: [string, string | undefined][] = [];
  const host = vaultEmbedHost({ agent: false, src: parseSource('main')!, theme: 'light', onNavigate: (p, a) => void opened.push([p, a]) });
  assert.equal(host.docHref('projects/demo/docs/flow.md', 'L12'), '/v/projects/demo/docs/flow.md#L12');
  host.openDoc('projects/demo/docs/flow.md', '흐름');
  assert.deepEqual(opened, [['projects/demo/docs/flow.md', '흐름']]);
  // 창이 없으면(SSR) 라우트 쓰기·구독은 아무것도 하지 않는다.
  host.writeHash('#/glossary', false);
  host.subscribe(() => {})();
  assert.equal(host.readHash(), '');
  assert.ok(fs.existsSync(path.join(MINI, SPEC)));
});
