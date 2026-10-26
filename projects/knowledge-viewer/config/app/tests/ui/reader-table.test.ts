// 표 보기: Reader 가 GFM 표를 감싸개·첫 열·짧은 셀 클래스와 함께 그리는지 SSR 로 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import type { DocResponse } from '../../src/app/types.ts';

const { Reader } = await import('../../src/reader/Reader.tsx');

const doc = (body: string): DocResponse => ({
  source: 'local',
  head: null,
  path: 'projects/README.md',
  title: 'projects',
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

const render = (body: string, agent = false): string =>
  renderToStaticMarkup(createElement(Reader, { doc: doc(body), agent, onNavigate: () => {} }));

const TABLE = [
  '| 프로젝트 | 상태 | 목적 |',
  '| --- | --- | --- |',
  '| [photo-measurement](https://example.com/p) | active | 사진 속 카드 기준물로 대상 치수를 측정하는 신규 웹 앱 |',
  '',
].join('\n');

test('Reader 표: table 을 .table-wrap 으로 감싼다', () => {
  const html = render(TABLE);
  assert.match(html, /<div class="table-wrap"><table[^>]*>/);
});

test('Reader 표: 첫 열 셀에는 cell-first, 짧은 셀에는 cell-short 가 붙고 긴 셀에는 둘 다 없다', () => {
  const html = render(TABLE);
  assert.match(html, /<th class="cell-first[^"]*"/);
  assert.match(html, /<td class="cell-first[^"]*"[^>]*><a /);
  assert.match(html, /<td class="cell-short"[^>]*>active<\/td>/);
  assert.match(html, /<td[^>]*>사진 속 카드 기준물로/);
  assert.doesNotMatch(html, /<td class="[^"]*"[^>]*>사진 속 카드 기준물로/);
});

test('Reader 표: 사람 모드의 th 에는 열 폭 손잡이가 붙고 에이전트 모드에는 없다', () => {
  assert.match(render(TABLE), /<th[^>]*>프로젝트<span class="th-resizer"/);
  assert.doesNotMatch(render(TABLE, true), /th-resizer/);
});

test('Reader 표: 에이전트 모드에도 감싸개와 셀 클래스는 그대로다', () => {
  const html = render(TABLE, true);
  assert.match(html, /<div class="table-wrap">/);
  assert.match(html, /<td class="cell-short">active<\/td>/);
});
