import { test } from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/tsx-hooks.ts';

import { activeHeadingIndex, TOC_ACTIVE_OFFSET } from '../../src/reader/toc-active.ts';

// 헤딩 다섯 개, 내용 3000px, 뷰포트 600px.
const tops = [0, 400, 900, 1500, 2700];
const box = (scrollTop: number) => ({ scrollTop, viewport: 600, content: 3000 });

test('맨 위: 첫 헤딩', () => {
  assert.equal(activeHeadingIndex(tops, box(0)), 0);
  // 둘째 헤딩이 기준선(80px) 안이어도 맨 위에서는 첫 헤딩이다.
  assert.equal(activeHeadingIndex([0, 60, 900], box(0)), 0);
  // 첫 헤딩이 아직 안 보이는 깊이여도 맨 위에서는 첫 헤딩이다.
  assert.equal(activeHeadingIndex([300, 900], box(0)), 0);
});

test('중간: 기준선(scrollTop + offset)을 지나간 마지막 헤딩', () => {
  assert.equal(activeHeadingIndex(tops, box(400 - TOC_ACTIVE_OFFSET)), 1); // 딱 기준선
  assert.equal(activeHeadingIndex(tops, box(400 - TOC_ACTIVE_OFFSET - 1)), 0); // 1px 모자람
  assert.equal(activeHeadingIndex(tops, box(1000)), 2);
  assert.equal(activeHeadingIndex(tops, box(1500)), 3);
});

test('바닥: 마지막 헤딩(기준선을 아직 안 지났어도)', () => {
  assert.equal(activeHeadingIndex(tops, box(2400)), 4);
  assert.equal(activeHeadingIndex(tops, box(2399)), 4); // 2px 여유
  assert.equal(activeHeadingIndex(tops, box(2390)), 3);
});

test('스크롤 없는 짧은 문서는 바닥 규칙을 쓰지 않는다', () => {
  assert.equal(activeHeadingIndex([0, 300], { scrollTop: 0, viewport: 600, content: 600 }), 0);
});

test('같은 위치 헤딩이 여럿이면 뒤의 것', () => {
  assert.equal(activeHeadingIndex([0, 500, 500, 900], box(450)), 2);
  assert.equal(activeHeadingIndex([0, 0, 900], box(0)), 1);
});

test('헤딩 없음: -1, 잴 수 없는 헤딩(NaN)은 건너뛴다', () => {
  assert.equal(activeHeadingIndex([], box(0)), -1);
  assert.equal(activeHeadingIndex([Number.NaN, Number.NaN], box(500)), -1);
  assert.equal(activeHeadingIndex([Number.NaN, 400, Number.NaN, 900], box(1000)), 3);
  assert.equal(activeHeadingIndex([Number.NaN, 400, 900], box(0)), 1);
});

test('Toc SSR: 위치를 재기 전에는 활성 항목이 없다', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { Toc } = await import('../../src/reader/Toc.tsx');
  const html = renderToStaticMarkup(createElement(Toc, { headings: [{ depth: 1, text: '하나', slug: 'one', line: 1 }] }));
  assert.ok(!html.includes('toc-active') && !html.includes('aria-current'), html);
});
