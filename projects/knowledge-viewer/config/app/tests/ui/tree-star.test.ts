// 트리 행의 ★ 북마크 토글: 켜짐·꺼짐 표기, 링크 밖 형제 단추, 북마크 섹션 행에도 붙는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import { BOOKMARKS_KEY, type Bookmark } from '../../src/app/bookmarks.ts';

const seeded: Bookmark[] = [{ path: 'wiki/a.md', title: 'A 글', addedAt: 1 }];
const store = new Map<string, string>([[BOOKMARKS_KEY, JSON.stringify(seeded)]]);
// useBookmarks 는 모듈을 불러올 때 저장값을 한 번 읽는다 — 동적 import 가 끝날 때까지 저장소가 있어야 하므로 이 파일 동안 전역에 둔다.
(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
const { TreeStar } = await import('../../src/app/TreeStar.tsx');
const { BookmarkSection } = await import('../../src/app/BookmarkSection.tsx');

const render = (path: string, title = 't'): string => renderToStaticMarkup(createElement(TreeStar, { path, title }));

test('북마크된 경로는 켜진 별 — aria-pressed·채운 폴리곤·해제 안내', () => {
  const html = render('wiki/a.md');
  assert.match(html, /<button type="button" class="tree-star tree-star-on" aria-pressed="true" aria-label="북마크 해제"/);
  assert.ok(html.includes('fill="currentColor"'));
  assert.ok(html.includes('누르면 해제'));
});

test('아닌 경로는 빈 별 — aria-pressed false·추가 안내', () => {
  const html = render('wiki/b.md');
  assert.match(html, /class="tree-star" aria-pressed="false" aria-label="북마크 추가"/);
  assert.ok(html.includes('fill="none"'));
});

test('북마크 섹션 행마다 링크 뒤에 켜진 별 단추가 선다(링크 안이 아니라 형제)', () => {
  const html = renderToStaticMarkup(createElement(BookmarkSection, { items: seeded, current: '', agent: false, src: { kind: 'main' }, onOpen: () => {} }));
  const li = html.match(/<li class="tree-item-file">(.*?)<\/li>/)?.[1] ?? '';
  assert.ok(li.includes('</a><button type="button" class="tree-star tree-star-on"'), '별은 </a> 뒤의 형제');
  assert.equal((li.match(/<button/g) ?? []).length, 1);
});
