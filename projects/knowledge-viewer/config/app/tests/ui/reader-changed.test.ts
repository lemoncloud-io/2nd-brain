// PR 변경 표식이 블록 종류(코드 블록·mermaid·h2·목록)와 무관하게 sanitize 를 지나 화면에 남는지 SSR 로 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import type { DocChange, DocResponse } from '../../src/app/types.ts';

const { Reader } = await import('../../src/reader/Reader.tsx');

const doc = (body: string, change: DocChange): DocResponse => ({
  source: 'pr:1',
  head: null,
  path: 'wiki/doc.md',
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
  change,
});

const M = (hunks: { start: number; end: number }[], removed: { afterLine: number; count: number }[] = []): DocChange => ({
  status: 'M',
  hunks,
  removed,
  added: 1,
  deleted: 0,
});

const render = (body: string, change: DocChange, agent = false): string =>
  renderToStaticMarkup(createElement(Reader, { doc: doc(body, change), agent, onNavigate: () => {} }));

// 줄 1: 단락, 줄 3-5: 코드 블록.
const MERMAID = 'intro\n\n```mermaid\ngraph TD; A-->B\n```\n';
const JS = 'intro\n\n```js\nconst a = 1;\n```\n';

test('바뀐 mermaid 블록도 mermaid 그릇으로 그리고 표식을 단다', () => {
  const html = render(MERMAID, M([{ start: 4, end: 4 }]));
  assert.ok(html.includes('class="mermaid mermaid-pending changed"'), html);
  assert.ok(!html.includes('graph TD'), html);
  assert.ok(!html.includes('class=""'), html);
});

test('바뀐 js 코드 블록은 language-js 를 지키고 <pre> 에 changed', () => {
  const html = render(JS, M([{ start: 4, end: 4 }]));
  assert.ok(html.includes('<pre class="changed"><code class="language-js">'), html);
});

test('에이전트 모드: 코드 블록 <pre> 에 data-changed="1", 클래스 없음', () => {
  const html = render(JS, M([{ start: 4, end: 4 }]), true);
  assert.ok(html.includes('<pre data-changed="1"><code class="language-js">'), html);
  assert.ok(!html.includes('class="changed"'), html);
});

test('코드 블록에 떨어진 removed 는 <pre> 에 data-removed', () => {
  const html = render(JS, M([], [{ afterLine: 2, count: 3 }]));
  assert.ok(html.includes('<pre data-removed="3"><code class="language-js">'), html);
  const mm = render(MERMAID, M([], [{ afterLine: 2, count: 3 }]));
  assert.ok(/<div class="mermaid mermaid-pending" data-removed="3"[^>]*>/.test(mm), mm);
});

test('바뀌지 않은 코드 블록은 그대로', () => {
  const html = render(JS, M([{ start: 1, end: 1 }]));
  assert.ok(html.includes('<pre><code class="language-js">'), html);
  assert.ok(html.includes('<p class="changed">intro</p>'), html);
});

test('바뀐 ## 헤딩은 id 를 지키고 class="changed"', () => {
  const html = render('intro\n\n## 둘째\n', M([{ start: 3, end: 3 }]));
  assert.ok(/<h2 id="둘째" class="changed"[^>]*>둘째<\/h2>/.test(html), html);
});

test('바뀐 목록은 <ul>·<ol> 에 class="changed"', () => {
  const ul = render('- a\n- b\n', M([{ start: 2, end: 2 }]));
  assert.ok(ul.includes('<ul class="changed">'), ul);
  const ol = render('1. a\n2. b\n', M([{ start: 1, end: 1 }]));
  assert.ok(ol.includes('<ol class="changed">'), ol);
});

test('h2·ul 의 다른 클래스는 여전히 벗겨진다', () => {
  const html = render('<h2 class="evil changed">x</h2>\n\n<ul class="evil"><li>y</li></ul>\n', M([]));
  assert.ok(!html.includes('evil'), html);
});

test('CHANGED_SELECTOR: 요약과 PR 상세 패널이 같은 표식(changed·data-changed·data-removed)을 센다', async () => {
  const { CHANGED_SELECTOR, CHANGED_IN_DOC } = await import('../../src/reader/changed-dom.ts');
  assert.equal(CHANGED_SELECTOR, '.changed, [data-changed], [data-removed]');
  assert.equal(CHANGED_IN_DOC, '.doc .changed, .doc [data-changed], .doc [data-removed]');
});
