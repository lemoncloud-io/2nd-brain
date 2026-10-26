// 북마크 저장소. 순수 함수다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bookmarkLabel,
  isBookmarked,
  loadBookmarks,
  normalizeBookmarks,
  removeBookmark,
  saveBookmarks,
  sortBookmarks,
  toggleBookmark,
  BOOKMARKS_KEY,
} from '../../src/app/bookmarks.ts';

test('toggle: 없으면 앞에 더하고 있으면 뺀다', () => {
  const a = toggleBookmark([], 'wiki/a.md', 'A', 1);
  assert.deepEqual(a, [{ path: 'wiki/a.md', title: 'A', addedAt: 1 }]);
  const b = toggleBookmark(a, 'wiki/b.md', 'B', 2);
  assert.equal(b[0].path, 'wiki/b.md');
  assert.equal(isBookmarked(b, 'wiki/a.md'), true);
  const c = toggleBookmark(b, 'wiki/a.md', 'A', 3);
  assert.equal(isBookmarked(c, 'wiki/a.md'), false);
  assert.equal(removeBookmark(c, 'wiki/b.md').length, 0);
});

test('normalize: 모양이 틀리거나 겹치는 경로는 버린다', () => {
  assert.deepEqual(normalizeBookmarks('x'), []);
  const out = normalizeBookmarks([{ path: 'a.md', title: 'A' }, { path: 'a.md', title: 'dup' }, { nope: 1 }, { path: '', title: '' }]);
  assert.deepEqual(out, [{ path: 'a.md', title: 'A', addedAt: 0 }]);
});

test('load/save: 가짜 storage 왕복, 깨진 JSON 은 빈 목록', () => {
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  saveBookmarks([{ path: 'a.md', title: 'A', addedAt: 5 }], storage);
  assert.equal(JSON.parse(mem.get(BOOKMARKS_KEY) ?? '[]').length, 1);
  assert.deepEqual(loadBookmarks(storage), [{ path: 'a.md', title: 'A', addedAt: 5 }]);
  mem.set(BOOKMARKS_KEY, '{bad');
  assert.deepEqual(loadBookmarks(storage), []);
});

test('sortBookmarks: 최근 추가한 것이 위, 같은 시각은 들어온 순서', () => {
  const list = [
    { path: 'a.md', title: 'A', addedAt: 1 },
    { path: 'b.md', title: 'B', addedAt: 3 },
    { path: 'c.md', title: 'C', addedAt: 3 },
    { path: 'd.md', title: 'D', addedAt: 2 },
  ];
  assert.deepEqual(sortBookmarks(list).map((b) => b.path), ['b.md', 'c.md', 'd.md', 'a.md']);
  assert.deepEqual(list.map((b) => b.path), ['a.md', 'b.md', 'c.md', 'd.md'], '원본을 바꾸지 않는다');
});

test('bookmarkLabel: 제목이 비면 파일 이름', () => {
  assert.equal(bookmarkLabel({ path: 'wiki/a.md', title: '제목' }), '제목');
  assert.equal(bookmarkLabel({ path: 'wiki/a.md', title: '  ' }), 'a.md');
  assert.equal(bookmarkLabel({ path: 'README.md', title: '' }), 'README.md');
});
