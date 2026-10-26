// 본문 파이프라인(remark → rehype-raw → sanitize → urlTransform → 컴포넌트) 전체를 SSR 로 돌려 위험 요소가 남지 않는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import type { Source } from '../../shared/source.ts';
import type { DocResponse } from '../../src/app/types.ts';

const { Reader } = await import('../../src/reader/Reader.tsx');

const doc = (body: string, path = 'wiki/doc.md'): DocResponse => ({
  source: 'local',
  head: null,
  path,
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

const render = (body: string, path?: string): string =>
  renderToStaticMarkup(createElement(Reader, { doc: doc(body, path), agent: false, onNavigate: () => {} }));

test('Reader: 스크립트·이벤트 속성·javascript:·iframe·주석을 남기지 않는다', () => {
  const html = render(
    [
      '# 제목',
      '',
      '<script>alert(1)</script>',
      '',
      '<img src=x onerror=alert(1)>',
      '',
      '[x](javascript:alert(1)) [y](JAVASCRIPT:alert(2))',
      '',
      '<iframe src=//evil></iframe>',
      '',
      '<!-- c -->',
      '',
      '<a href="javascript:alert(3)" onclick="alert(4)">z</a>',
      '',
      '<details><summary>s</summary>d</details>',
      '',
    ].join('\n'),
  );
  const lower = html.toLowerCase();
  assert.ok(!lower.includes('<script'), html);
  assert.ok(!lower.includes('onerror'), html);
  assert.ok(!lower.includes('onclick'), html);
  assert.ok(!lower.includes('javascript:'), html);
  assert.ok(!lower.includes('<iframe'), html);
  assert.ok(!html.includes('<!--'), html);
  assert.ok(html.includes('<details'), html);
  assert.ok(html.includes('<summary>s</summary>'), html);
});

test('Reader: 상대 첨부는 /raw 새 탭(소스 접두), html 은 앱 안 /v, 루트 밖은 죽은 링크', () => {
  const html = render('[p](../outputs/r.pdf) [h](./sub/v.html#/x) [e](../../x.pdf)', 'wiki/doc.md');
  // 기본 소스는 main 이다 — /raw 도 같은 소스를 읽는다.
  assert.match(html, /<a href="\/raw\/@main\/outputs\/r\.pdf" target="_blank" rel="noreferrer">p<\/a>/);
  const withSrc = (src: Source): string =>
    renderToStaticMarkup(createElement(Reader, { doc: doc('[p](../outputs/r.pdf)'), agent: false, src, onNavigate: () => {} }));
  assert.match(withSrc({ kind: 'local' }), /<a href="\/raw\/outputs\/r\.pdf"/);
  assert.match(withSrc({ kind: 'pr', number: 3 }), /<a href="\/raw\/@pr\/3\/outputs\/r\.pdf"/);
  assert.match(html, /<a href="\/v\/wiki\/sub\/v\.html#\/x" data-vault-path="wiki\/sub\/v\.html">h<\/a>/);
  assert.match(html, /<span class="link-dead"[^>]*>e<\/span>/);
});

test('Reader: changed 클래스·data-removed 는 sanitize 를 지나고, 다른 클래스·data-* 는 벗겨진다', () => {
  const body = 'one\n\ntwo\n\nthree\n\n<p class="evil changed" data-x="1" data-removed="9">raw</p>\n';
  const d: DocResponse = {
    ...doc(body),
    change: { status: 'M', hunks: [{ start: 3, end: 3 }], removed: [{ afterLine: 3, count: 2 }], added: 1, deleted: 2 },
  };
  const html = renderToStaticMarkup(createElement(Reader, { doc: d, agent: false, onNavigate: () => {} }));
  assert.ok(html.includes('<p class="changed">two</p>'), html);
  assert.ok(html.includes('<p data-removed="2">three</p>'), html);
  assert.ok(!html.includes('evil'), html);
  assert.ok(!html.includes('data-x'), html);
});

test('Reader: 에이전트 모드는 클래스 없이 data-changed="1"', () => {
  const d: DocResponse = {
    ...doc('one\n\ntwo\n'),
    change: { status: 'M', hunks: [{ start: 3, end: 3 }], removed: [], added: 1, deleted: 0 },
  };
  const html = renderToStaticMarkup(createElement(Reader, { doc: d, agent: true, onNavigate: () => {} }));
  assert.ok(html.includes('<p data-changed="1">two</p>'), html);
  assert.ok(!html.includes('class="changed"'), html);
});

test('Reader: change 가 없거나 status null 이면 요약 줄이 없다', () => {
  assert.ok(!render('one\n').includes('doc-change-summary'));
  const d: DocResponse = { ...doc('one\n'), change: { status: null, hunks: [], removed: [], added: 0, deleted: 0 } };
  const html = renderToStaticMarkup(createElement(Reader, { doc: d, agent: false, onNavigate: () => {} }));
  assert.ok(!html.includes('doc-change-summary'), html);
});

test('Reader: 요약 줄 — 고친 문서와 새 문서', () => {
  const m: DocResponse = { ...doc('one\n'), change: { status: 'M', hunks: [{ start: 1, end: 1 }], removed: [], added: 3, deleted: 2 } };
  const hm = renderToStaticMarkup(createElement(Reader, { doc: m, agent: false, onNavigate: () => {} }));
  // SSR 에선 effect 가 돌지 않아 블록 수는 0 으로 시작한다.
  assert.ok(hm.includes('이 PR 에서 추가 3줄 · 삭제 2줄 · 블록 0개'), hm);
  const a: DocResponse = { ...doc('one\n'), change: { status: 'A', hunks: [{ start: 1, end: 1 }], removed: [], added: 1, deleted: 0 } };
  const ha = renderToStaticMarkup(createElement(Reader, { doc: a, agent: false, onNavigate: () => {} }));
  assert.ok(ha.includes('이 PR 에서 새로 만든 문서 · 추가 1줄'), ha);
});

test('Toc: 바뀐 범위가 든 절의 헤딩에 점(헤딩 줄만이 아니다)', async () => {
  const { Toc } = await import('../../src/reader/Toc.tsx');
  const headings = [
    { depth: 1, text: '하나', slug: 'one', line: 3 },
    { depth: 2, text: '둘', slug: 'two', line: 10 },
    { depth: 1, text: '셋', slug: 'three', line: 20 },
  ];
  // 5~6 은 '하나' 절 안(둘 앞) — 헤딩 줄이 아니어도 점.
  const html = renderToStaticMarkup(createElement(Toc, { headings, change: { hunks: [{ start: 5, end: 6 }], removed: [] }, endLine: 30 }));
  assert.equal(html.split('toc-dot').length - 1, 1, html);
  assert.ok(html.includes('<a href="#one"><span class="toc-dot" role="img" aria-label="변경"></span>하나</a>'), html);
  // 12 는 '둘' 절 → 둘·하나. 25 를 지운 자리는 '셋'.
  const nested = renderToStaticMarkup(
    createElement(Toc, { headings, change: { hunks: [{ start: 12, end: 12 }], removed: [{ afterLine: 25, count: 1 }] }, endLine: 30 }),
  );
  assert.equal(nested.split('toc-dot').length - 1, 3, nested);
  const none = renderToStaticMarkup(createElement(Toc, { headings }));
  assert.ok(!none.includes('toc-dot'), none);
});
