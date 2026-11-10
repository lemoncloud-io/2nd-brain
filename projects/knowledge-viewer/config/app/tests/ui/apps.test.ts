// 앱 플러그인 화면 계약(M1): 라우트(/apps/<id>, 해시는 앱 것), 토큰 meta 읽기, 앱 없음·토큰 없음·불러오는 중 화면,
// 상단바 "앱" 메뉴(0개면 숨김), 뷰어 모음 패널의 앱 항목. SSR 로 그려 구조만 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import { MAIN } from '../../shared/source.ts';
import { appHref, appIdOf, parseLocation } from '../../src/app/route.ts';
import { APP_UIS, appApiBase, appDocLinks, appRootClass, findAppUi, type AppHostProps, type ViewerAppUi } from '../../src/apps/registry.ts';
import { LOCAL } from '../../shared/source.ts';
import type { DocResponse } from '../../src/app/types.ts';
import { APP_TOKEN_META, readAppToken } from '../../src/apps/token.ts';
import { APP_TOKEN_META as SERVER_META } from '../../server/static.ts';
import type { VaultInfo } from '../../src/app/types.ts';
import { FAKE_APPS, FAKE_APP_UIS, demoPostId } from '../helpers/fake-ext.ts';
import { reservedIdProblem, viewerAppClassSuffixes } from '../helpers/app-ids.ts';

const { AppView } = await import('../../src/apps/AppView.tsx');
const { AppsMenu } = await import('../../src/apps/AppsMenu.tsx');
const { TopBar } = await import('../../src/app/TopBar.tsx');
const { ViewersPanel } = await import('../../src/panels/ViewersPanel.tsx');
const { MetaPanel } = await import('../../src/reader/MetaPanel.tsx');

const G0 = { depth: 2, mode: '3d', all: false } as const;
const TOKEN = 'ab'.repeat(32);

/** 가짜 앱 화면: 받은 props 를 그대로 글자로. */
const FakeApp = (p: AppHostProps) => createElement('p', { className: 'fake' }, `${p.apiBase}|${p.token}|${p.agent}`);
const fakeUi: ViewerAppUi = { id: 'fake', title: '가짜 앱', icon: 'checklist', load: async () => ({ App: FakeApp }) };
const { AppIcon } = await import('../../src/apps/app-icons.tsx');
const { IconBranch, IconChecklist, IconGrid } = await import('../../src/app/icons.tsx');
/** 아이콘 하나의 SSR 결과 — 기대값 비교용. */
const svgOf = (C: (p: { size?: number }) => unknown, size?: number) => renderToStaticMarkup(createElement(C as never, { size }));

test('라우트: /apps/<id> 는 앱, 해시는 앵커로 읽지 않는다, agent 는 통과', () => {
  assert.deepEqual(parseLocation('/apps/fake', '?agent=claude', '#view=run&post=a'), { path: 'wiki/INDEX.md', anchor: '', agent: true, src: MAIN, view: 'doc', graph: G0, app: 'fake' });
  assert.equal(parseLocation('/apps/fake/sub', '', '').app, 'fake');
  assert.equal(parseLocation('/apps', '', '').app, '');
  assert.equal(parseLocation('/apps/', '', '').app, '');
  // 문서 주소에는 app 키가 없다(기존 모양 그대로).
  assert.equal('app' in parseLocation('/v/wiki/a.md', '', '#x'), false);
  assert.equal(parseLocation('/v/apps/fake', '', '').app, undefined);
  assert.equal(appIdOf('/appsx'), null);
  assert.equal(appIdOf('/apps/%66ake'), 'fake');
});

test('appHref: 에이전트 모드면 ?agent=claude', () => {
  assert.equal(appHref('fake', false), '/apps/fake');
  assert.equal(appHref('fake', true), '/apps/fake?agent=claude');
});

test('등록부: 확장이 없으면 앱 0(유닛 시험은 빈 확장), 기준점·루트 클래스 규칙', () => {
  assert.deepEqual(APP_UIS, []);
  assert.equal(appRootClass('demo-board'), 'app-demo-board');
  assert.equal(appApiBase('demo-board'), '/api/apps/demo-board');
  assert.equal(findAppUi([fakeUi], 'fake'), fakeUi);
  assert.equal(findAppUi([fakeUi], 'nope'), null);
});

test('토큰: meta 에서만 읽는다. 서버와 같은 이름, hex 가 아니면 빈 값', () => {
  assert.equal(APP_TOKEN_META, SERVER_META);
  const doc = (content: string | null) => ({
    querySelector: (sel: string) => (sel === `meta[name="${APP_TOKEN_META}"]` && content !== null ? ({ getAttribute: () => content } as unknown as Element) : null),
  });
  assert.equal(readAppToken(doc(TOKEN)), TOKEN);
  assert.equal(readAppToken(doc(null)), '');
  assert.equal(readAppToken(doc('"><x')), '');
  assert.equal(readAppToken(undefined), '');
});

test('AppView: 등록되지 않은 id 는 "앱 없음" 과 등록된 앱 링크', () => {
  const html = renderToStaticMarkup(createElement(AppView, { id: 'nope', apps: [fakeUi], token: TOKEN, agent: true, navigate: () => {} }));
  assert.match(html, /<h1>앱 없음<\/h1>/);
  assert.ok(html.includes('<code>nope</code>'));
  assert.ok(html.includes('href="/apps/fake?agent=claude"'));
  const empty = renderToStaticMarkup(createElement(AppView, { id: '', apps: [], token: '', agent: false, navigate: () => {} }));
  assert.match(empty, /앱 없음/);
  assert.equal(empty.includes('<ul'), false);
});

test('AppView: 토큰이 없으면 다시 열기 안내', () => {
  const html = renderToStaticMarkup(createElement(AppView, { id: 'fake', apps: [fakeUi], token: '', agent: false, navigate: () => {} }));
  assert.ok(html.includes('앱 토큰이 없다'));
  assert.ok(html.includes('href="/apps/fake"'));
});

test('AppView: 등록된 앱은 지연 import 동안 안내, 자리는 data-app-id', () => {
  const html = renderToStaticMarkup(createElement(AppView, { id: 'fake', apps: [fakeUi], token: TOKEN, agent: false, navigate: () => {} }));
  assert.ok(html.includes('data-app-id="fake"'), html);
  assert.ok(html.includes('앱을 불러오는 중'), html);
});

test('AppsMenu: 앱이 0 이면 그리지 않고, 있으면 링크(전체 이동)와 지금 앱 표시', () => {
  assert.equal(renderToStaticMarkup(createElement(AppsMenu, { apps: [], agent: false })), '');
  const html = renderToStaticMarkup(createElement(AppsMenu, { apps: [fakeUi], agent: true, current: 'fake' }));
  assert.ok(html.includes('<summary'));
  assert.ok(html.includes('href="/apps/fake?agent=claude"'));
  assert.ok(html.includes('aria-current="page"'));
  assert.ok(html.includes('가짜 앱'));
});

test('AppsMenu: 단추는 글자 "앱" 대신 격자 아이콘, aria-label·title 은 "앱"', () => {
  const html = renderToStaticMarkup(createElement(AppsMenu, { apps: [fakeUi], agent: false }));
  const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(html);
  assert.ok(summary, html);
  assert.ok(summary[0].includes('aria-label="앱"'));
  assert.ok(summary[0].includes('title="앱"'));
  assert.ok(summary[0].includes('class="icon-btn apps-toggle"'));
  // 안쪽은 SVG 하나(격자)뿐 — 태그를 지운 텍스트가 비어 있어야 한다.
  assert.equal(summary[1], svgOf(IconGrid));
  assert.equal(summary[1]!.replace(/<[^>]+>/g, '').trim(), '');
});

test('AppsMenu: 항목 앞 .apps-menu-icon 은 그 앱의 아이콘 SVG(글자 없음)', () => {
  const html = renderToStaticMarkup(createElement(AppsMenu, { apps: [fakeUi, ...FAKE_APP_UIS], agent: false }));
  const icons = [...html.matchAll(/<span class="apps-menu-icon" aria-hidden="true">([\s\S]*?)<\/span>/g)].map((m) => m[1]!);
  assert.equal(icons.length, 1 + FAKE_APP_UIS.length);
  for (const inner of icons) {
    assert.ok(inner.startsWith('<svg'), inner);
    assert.equal(inner.replace(/<[^>]+>/g, '').trim(), '');
  }
  assert.equal(icons[0], svgOf(IconChecklist, 14));
});

test('AppIcon: 아는 이름은 그 아이콘, 모르는 이름·없음·상속 이름은 기본(격자)으로 폴백', () => {
  const draw = (name: string | null | undefined) => renderToStaticMarkup(createElement(AppIcon, { name, size: 14 }));
  assert.equal(draw('checklist'), svgOf(IconChecklist, 14));
  assert.equal(draw('grid'), svgOf(IconGrid, 14));
  assert.equal(draw('branch'), svgOf(IconBranch, 14));
  assert.notEqual(svgOf(IconBranch, 14), svgOf(IconGrid, 14));
  for (const bad of ['W', 'nope', '', 'toString', null, undefined]) assert.equal(draw(bad), svgOf(IconGrid, 14), String(bad));
  // 등록부 항목의 이름은 모두 그려진다.
  for (const a of FAKE_APP_UIS) assert.notEqual(draw(a.icon), '', a.id);
});

test('뷰어 모음 패널: 앱 항목 아이콘은 등록부의 앱 아이콘, 등록부에 없는 id 는 기본 아이콘', () => {
  const html = renderToStaticMarkup(
    createElement(ViewersPanel, {
      agent: false,
      navigate: () => {},
      initial: { viewers: [], fetchedAt: '', error: null },
      port: '8792',
      apps: [
        { id: 'demo-board', title: 'W', ready: true },
        { id: 'unknown-app', title: 'U', ready: true },
      ],
      appUis: FAKE_APP_UIS,
    }),
  );
  const card = (id: string) => new RegExp(`data-app-id="${id}"[\\s\\S]*?<span class="viewer-icon" aria-hidden="true">([\\s\\S]*?)</span>`).exec(html)?.[1];
  assert.equal(card('demo-board'), svgOf(IconChecklist, 14));
  assert.equal(card('unknown-app'), svgOf(IconGrid, 14));
});

const noop = () => {};
const info: VaultInfo = { name: 'knowledge', branch: 'b', head: 'abc1234', worktree: false, dirty: false, sources: { main: { available: true, head: 'abc1234', fetchedAt: 1 }, local: { available: true, head: 'abc1234' } } };
const bar = {
  path: 'wiki/INDEX.md',
  agent: false,
  view: 'doc' as const,
  rightOpen: true,
  leftOpen: true,
  onExpand: noop,
  onNavigate: noop,
  onSearchPick: noop,
  onToggleRight: noop,
  onToggleLeft: noop,
  onToggleView: noop,
  src: { kind: 'main' } as const,
  prs: [],
  mainAvailable: true,
  onSourceChange: noop,
  info,
  head: null,
  fallbackReason: null,
  changes: null,
  onBadgeClick: noop,
  searchAll: false,
  onSearchAll: noop,
};

test('상단바: 앱이 없으면 "앱" 메뉴가 없다(기존 모양 그대로)', () => {
  const html = renderToStaticMarkup(createElement(TopBar, bar));
  assert.equal(html.includes('apps-menu'), false);
  assert.ok(html.includes('왼쪽 패널 접기'));
});

test('상단바: 앱 화면이면 경로 대신 "앱 / 제목", 양옆 토글·지도·북마크 없음, 앱 메뉴는 있음', () => {
  const html = renderToStaticMarkup(createElement(TopBar, { ...bar, apps: [fakeUi], app: { id: 'fake', title: '가짜 앱' } }));
  assert.ok(html.includes('apps-menu'));
  assert.match(html, /<span class="crumb crumb-file" aria-current="page">가짜 앱<\/span>/);
  for (const gone of ['왼쪽 패널', '오른쪽 패널', '연결 지도', '북마크', '>INDEX.md<']) assert.equal(html.includes(gone), false, gone);
});

test('뷰어 모음 패널: 앱 항목은 "앱" 묶음, 이 화면 안 주소, 준비 안 된 앱은 사유', () => {
  const html = renderToStaticMarkup(
    createElement(ViewersPanel, {
      agent: true,
      navigate: noop,
      initial: { viewers: [], fetchedAt: '', error: null },
      port: '8792',
      apps: [
        { id: 'fake', title: '가짜 앱', ready: true },
        { id: 'broken', title: '깨진 앱', ready: false, reason: '모듈이 없다' },
      ],
    }),
  );
  assert.ok(html.includes('<li class="viewers-group">앱</li>'));
  assert.ok(html.includes('href="/apps/fake?agent=claude"'));
  assert.ok(html.includes('viewer-dot-up'));
  assert.ok(html.includes('모듈이 없다'));
  // 앱이 없으면 묶음도 없다.
  const none = renderToStaticMarkup(createElement(ViewersPanel, { agent: false, navigate: noop, initial: { viewers: [], fetchedAt: '', error: null }, port: '8792', apps: [] }));
  assert.equal(none.includes('viewers-apps'), false);
});

test('앱 id 예약어: 뷰어 레이아웃 클래스(app-agent·app-left-collapsed …)와 겹치는 id 는 거부', () => {
  const used = viewerAppClassSuffixes();
  // 수집이 실제로 도는지: 알려진 레이아웃 클래스가 잡혀야 한다.
  for (const known of ['agent', 'left-collapsed', 'right-collapsed', 'host', 'missing']) assert.equal(used.exact.has(known), true, known);
  assert.equal(used.prefixes.includes('drawer-'), true);
  // 겹치는 id 는 거부, 그 밖은 통과.
  for (const bad of ['agent', 'left-collapsed', 'host', 'drawer-left', 'drawer-x']) assert.notEqual(reservedIdProblem(bad, used), null, bad);
  // 합성 서버·화면 등록부의 id 는 같고, 어느 것도 예약어와 겹치지 않는다(실제 id 는 확장 시험이 본다).
  assert.deepEqual(
    FAKE_APPS.map((a) => a.id),
    FAKE_APP_UIS.map((a) => a.id),
  );
  for (const a of FAKE_APP_UIS) assert.equal(reservedIdProblem(a.id, used), null, a.id);
});

/** 합성 앱(demo-board)이 다루는 데모 글. */
const POST = 'projects/demo/posts/2026-01-01-first.md';
const POST_ID = demoPostId(POST);

test('역방향 링크: docLink 가 고른 문서만 "…에서 열기", 에이전트 모드는 질의를 해시 앞에', () => {
  assert.deepEqual(appDocLinks(FAKE_APP_UIS, POST, false), [{ id: 'demo-board', title: '데모 보드', href: `/apps/demo-board#view=post&id=${POST_ID}` }]);
  assert.equal(appDocLinks(FAKE_APP_UIS, POST, true)[0]!.href, `/apps/demo-board?agent=claude#view=post&id=${POST_ID}`);
  // 다루지 않는 문서·docLink 없는 앱은 링크가 없다.
  for (const p of ['wiki/INDEX.md', 'projects/demo/posts/sub/a.md', 'projects/demo/README.md']) assert.deepEqual(appDocLinks(FAKE_APP_UIS, p, false), [], p);
  assert.deepEqual(appDocLinks([fakeUi], POST, false), []);
  // 확장이 없으면(기본 등록부) 링크도 없다.
  assert.deepEqual(appDocLinks(APP_UIS, POST, false), []);
});

test('MetaPanel: 앱이 다루는 문서면 "…에서 열기" 링크, 아니면 없다', () => {
  const mk = (path: string): DocResponse => ({ source: 'local', head: null, path, title: 'doc', frontmatter: {}, body: '', bodyStartLine: 1, headings: [], links: [], backlinks: [], stamp: { commit: null, dirty: false }, mtime: 0 }) as unknown as DocResponse;
  const html = renderToStaticMarkup(createElement(MetaPanel, { doc: mk(POST), agent: false, src: LOCAL, onNavigate: () => {}, paths: {}, apps: FAKE_APP_UIS }));
  assert.match(html, new RegExp(`<a href="/apps/demo-board#view=post&amp;id=${POST_ID}" data-app-id="demo-board">데모 보드에서 열기</a>`));
  const other = renderToStaticMarkup(createElement(MetaPanel, { doc: mk('wiki/INDEX.md'), agent: false, src: LOCAL, onNavigate: () => {}, paths: {}, apps: FAKE_APP_UIS }));
  assert.equal(other.includes('meta-app-links'), false);
  // 기본 등록부(빈 확장)면 링크 묶음이 없다.
  const none = renderToStaticMarkup(createElement(MetaPanel, { doc: mk(POST), agent: false, src: LOCAL, onNavigate: () => {}, paths: {} }));
  assert.equal(none.includes('meta-app-links'), false);
});
