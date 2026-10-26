// 트리 위 ★ 북마크 섹션을 SSR 로 그려 행·링크(소스 유지)·현재 강조·빈 상태 숨김·접힘 기억을 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import { withStorage } from '../helpers/fake-storage.ts';
import type { Bookmark } from '../../src/app/bookmarks.ts';
import type { Source } from '../../src/app/types.ts';

const { BookmarkSection } = await import('../../src/app/BookmarkSection.tsx');

const items: Bookmark[] = [
  { path: 'wiki/old.md', title: '오래된 글', addedAt: 1 },
  { path: 'outputs/no-title.md', title: '', addedAt: 3 },
  { path: 'wiki/new.md', title: '새 글', addedAt: 2 },
];

const render = (list: Bookmark[], src: Source, current = 'wiki/new.md', store = new Map<string, string>()): string =>
  withStorage(store, () => renderToStaticMarkup(createElement(BookmarkSection, { items: list, current, agent: false, src, onOpen: () => {} })));

const hrefs = (html: string) => [...html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);

test('북마크가 없으면 섹션을 그리지 않는다', () => {
  assert.equal(render([], { kind: 'main' }), '');
});

test('행은 최근 추가순, 제목이 비면 파일 이름, 흐린 경로가 붙는다', () => {
  const html = render(items, { kind: 'main' });
  assert.ok(html.includes('aria-label="북마크"'));
  assert.deepEqual(hrefs(html), ['/v/outputs/no-title.md', '/v/wiki/new.md', '/v/wiki/old.md']);
  assert.ok(html.indexOf('no-title.md</span>') < html.indexOf('새 글'), '파일 이름 폴백이 맨 위');
  assert.ok(html.includes('<span class="tree-bms-path">wiki/old.md</span>'));
  assert.match(html, /tree-bms-count">3</);
});

test('현재 문서 행만 강조한다', () => {
  const html = render(items, { kind: 'main' });
  const rows = [...html.matchAll(/<a href="([^"]+)" class="([^"]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(
    rows.map(([href, cls]) => [href, cls!.includes('tree-current')]),
    [
      ['/v/outputs/no-title.md', false],
      ['/v/wiki/new.md', true],
      ['/v/wiki/old.md', false],
    ],
  );
});

test('링크는 지금 소스를 싣는다(local·pr), 섹션 끝에 구분선', () => {
  assert.deepEqual(hrefs(render(items, { kind: 'local' })), ['/v/outputs/no-title.md?src=local', '/v/wiki/new.md?src=local', '/v/wiki/old.md?src=local']);
  const pr = render(items, { kind: 'pr', number: 7 });
  assert.ok(pr.includes('/v/wiki/new.md?src=pr:7'), pr);
  assert.ok(pr.includes('<hr class="tree-sep"/>'));
});

test('저장된 접힘이면 헤더만 그리고 행은 숨긴다', () => {
  const store = new Map<string, string>([['knowledge-viewer.bookmarks-open', '0']]);
  const html = render(items, { kind: 'main' }, 'wiki/new.md', store);
  assert.ok(html.includes('aria-expanded="false"'));
  assert.equal(hrefs(html).length, 0);
  assert.match(html, /tree-bms-count">3</);
  const open = render(items, { kind: 'main' });
  assert.ok(open.includes('aria-expanded="true"'));
});
