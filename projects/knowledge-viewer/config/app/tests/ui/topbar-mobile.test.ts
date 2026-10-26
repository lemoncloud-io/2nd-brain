// 폰 폭 상단바의 구조: 경로 끝 두 조각 표시(crumb-tail), 검색 아이콘 단추, 검색 줄 자리. 보이고 숨기는 것은 mobile.css 다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';

const { TopBar } = await import('../../src/app/TopBar.tsx');

const noop = () => {};
const base = {
  path: 'projects/dou/features/dou-subscription-web/README.md',
  agent: false,
  view: 'doc' as const,
  rightOpen: false,
  leftOpen: false,
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
  info: null,
  head: null,
  fallbackReason: null,
  changes: null,
  onBadgeClick: noop,
  searchAll: false,
  onSearchAll: noop,
};

test('경로: 끝 두 조각만 crumb-tail, 루트는 crumb-root', () => {
  const html = renderToStaticMarkup(createElement(TopBar, base));
  const items = [...html.matchAll(/<span class="(crumb-item[^"]*)">/g)].map((m) => m[1]);
  assert.deepEqual(items, [
    'crumb-item crumb-root',
    'crumb-item',
    'crumb-item',
    'crumb-item',
    'crumb-item crumb-tail',
    'crumb-item crumb-tail',
  ]);
});

test('경로: 한 조각짜리도 그 조각이 tail', () => {
  const html = renderToStaticMarkup(createElement(TopBar, { ...base, path: 'README.md' }));
  assert.match(html, /<span class="crumb-item crumb-tail"><span class="crumb crumb-file" aria-current="page">README.md<\/span>/);
});

test('검색: 아이콘 단추는 닫힌 채(aria-expanded=false)로, 검색 줄 자리는 open class 없이 시작한다', () => {
  const html = renderToStaticMarkup(createElement(TopBar, base));
  assert.match(html, /class="icon-btn search-toggle" aria-expanded="false" aria-label="검색 열기"/);
  assert.match(html, /class="search-slot" data-slot="search"/);
  assert.doesNotMatch(html, /search-slot-open/);
});

test('서랍 토글: App 이 넘긴 열림(좁은 폭이면 서랍 상태)을 aria-pressed 로 싣는다', () => {
  const closed = renderToStaticMarkup(createElement(TopBar, base));
  assert.match(closed, /class="icon-btn left-toggle" aria-pressed="false" aria-label="왼쪽 패널 펴기"/);
  const open = renderToStaticMarkup(createElement(TopBar, { ...base, leftOpen: true }));
  assert.match(open, /class="icon-btn left-toggle" aria-pressed="true" aria-label="왼쪽 패널 접기"/);
});

test('에이전트 모드: 검색 단추도 서랍 토글도 없다', () => {
  const html = renderToStaticMarkup(createElement(TopBar, { ...base, agent: true }));
  assert.doesNotMatch(html, /search-toggle|left-toggle|right-toggle/);
});
