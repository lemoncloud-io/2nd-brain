// appEmbed Vite 플러그인(결정 5·9): 앱 CSS 는 .<rootClass> 아래로, 뷰어 CSS 는 그 안을 피하게, React 는 한 벌로.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { APP_DEDUPE, appEmbed, excludeAppCss, scopeAppCss } from '../../app-embed-plugin.ts';

const DIR = path.resolve('/vault/projects/demo/config/app/src');
const STYLES = path.resolve('/vault/projects/knowledge-viewer/config/app/src/styles') + path.sep;
const plugin = appEmbed({ id: 'demo', dir: DIR, rootClass: 'app-demo', hostCss: (f) => f.startsWith(STYLES) });

const APP_CSS = `/* 앱 전역 */
:root { --accent: red; }
body { margin: 0; }
.card, h1 > span { color: var(--accent); }
@media (max-width: 600px) { .card { padding: 0; } }
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(1turn); } }
`;

const VIEWER_CSS = `.notice { color: gray; }
a::before { content: ''; }
`;

test('scopeAppCss: 선택자를 루트 아래로, :root·body 는 루트 자신, @media 안도, @keyframes 는 그대로', () => {
  const out = scopeAppCss(APP_CSS, 'app-demo');
  assert.ok(out.includes('.app-demo { --accent: red; }'), out);
  assert.ok(out.includes('.app-demo { margin: 0; }'), out);
  assert.ok(out.includes('.app-demo .card,\n.app-demo h1 > span {'), out);
  assert.ok(out.includes('@media (max-width: 600px) {\n.app-demo .card {'), out);
  assert.ok(out.includes('@keyframes spin { from { transform: rotate(0); } to { transform: rotate(1turn); } }'), out);
  assert.equal(out.includes('앱 전역'), false);
});

test('excludeAppCss: 뷰어 선택자는 :not(.app-demo *) 로 앱 안을 피한다(의사 요소 앞)', () => {
  const out = excludeAppCss(VIEWER_CSS, 'app-demo');
  assert.ok(out.includes('.notice:not(.app-demo *) {'), out);
  assert.ok(out.includes("a:not(.app-demo *)::before {"), out);
});

test('transform: 앱 폴더 CSS 는 가두고(질의 붙어도), 뷰어 styles 는 피하게, 그 밖은 null', () => {
  const inApp = plugin.transform(APP_CSS, path.join(DIR, 'styles.css') + '?direct');
  assert.ok(inApp !== null && inApp.code.includes('.app-demo .card'));
  const host = plugin.transform(VIEWER_CSS, path.join(STYLES, 'layout.css'));
  assert.ok(host !== null && host.code.includes('.notice:not(.app-demo *)'));
  assert.equal(plugin.transform(VIEWER_CSS, path.resolve('/vault/elsewhere/x.css')), null);
  assert.equal(plugin.transform('export {}', path.join(DIR, 'App.tsx')), null);
  // 이름이 겹치는 형제 폴더(src-other)는 앱 폴더가 아니다.
  assert.equal(plugin.transform(APP_CSS, DIR + '-other/a.css'), null);
});

test('config: React 한 벌(dedupe), 개발 서버는 뷰어 루트와 앱 폴더를 읽는다', () => {
  const c = plugin.config({ root: '/vault/projects/knowledge-viewer/config/app' });
  assert.deepEqual(c.resolve.dedupe, APP_DEDUPE);
  for (const p of ['react', 'react-dom', 'react/jsx-runtime']) assert.ok(c.resolve.dedupe.includes(p), p);
  assert.deepEqual(c.server.fs.allow, [path.resolve('/vault/projects/knowledge-viewer/config/app'), DIR]);
  assert.equal(plugin.name, 'app-embed-demo');
  assert.equal(plugin.enforce, 'pre');
});

test('잘못된 id·루트 클래스는 설정 때 멈춘다', () => {
  assert.throws(() => appEmbed({ id: 'Bad', dir: DIR, rootClass: 'app-bad' }), /앱 id/);
  assert.throws(() => appEmbed({ id: 'ok', dir: DIR, rootClass: '.app-ok' }), /루트 클래스/);
  assert.throws(() => appEmbed({ id: 'ok', dir: DIR, rootClass: 'a b' }), /루트 클래스/);
});
