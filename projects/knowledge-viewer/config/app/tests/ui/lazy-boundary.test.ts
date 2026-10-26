// 지도 lazy 청크의 오류 경계: 오류를 받으면 안내를 그리고, resetKey 가 바뀌면 걷는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';

const { LazyBoundary } = await import('../../src/app/LazyBoundary.tsx');

const fallback = (m: string): ReactNode => createElement('p', { className: 'notice' }, `지도를 불러오지 못했다 — 새로고침해 달라: ${m}`);
const props = (resetKey: string) => ({ resetKey, fallback, children: createElement('span', null, '지도') });

test('LazyBoundary: 오류가 없으면 자식을 그린다', () => {
  assert.equal(renderToStaticMarkup(createElement(LazyBoundary, props('a'))), '<span>지도</span>');
});

test('LazyBoundary: 오류를 받으면 메시지를 담은 안내를 그린다', () => {
  const st = LazyBoundary.getDerivedStateFromError(new Error('Failed to fetch dynamically imported module'));
  assert.deepEqual(st, { message: 'Failed to fetch dynamically imported module' });
  const b = new LazyBoundary(props('a'));
  b.state = { ...b.state, ...st } as typeof b.state;
  const html = renderToStaticMarkup(b.render() as Parameters<typeof renderToStaticMarkup>[0]);
  assert.ok(html.includes('지도를 불러오지 못했다 — 새로고침해 달라: Failed to fetch'), html);
});

test('LazyBoundary: resetKey 가 같으면 오류를 두고, 바뀌면 걷는다', () => {
  const failed = { message: 'x', key: 'a' };
  assert.equal(LazyBoundary.getDerivedStateFromProps(props('a'), failed), null);
  assert.deepEqual(LazyBoundary.getDerivedStateFromProps(props('b'), failed), { message: null, key: 'b' });
});
