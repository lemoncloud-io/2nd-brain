// 폴더 화면을 SSR 로 그려 비-md 첨부 행의 /raw 링크가 현재 소스 접두를 따르는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import type { Source } from '../../shared/source.ts';
import type { TreeEntry } from '../../src/app/types.ts';

const { FolderView } = await import('../../src/app/FolderView.tsx');

const entries: TreeEntry[] = [
  { name: 'report.pdf', path: 'outputs/report.pdf', kind: 'file', ignored: false },
  { name: 'a.md', path: 'outputs/a.md', kind: 'md', ignored: false },
];

const render = (src: Source): string =>
  renderToStaticMarkup(createElement(FolderView, { dir: 'outputs', entries, agent: false, src, onNavigate: () => {} }));

test('FolderView: 비-md 첨부 행의 /raw 링크는 소스 접두를 따른다', () => {
  assert.match(render({ kind: 'pr', number: 5 }), /href="\/raw\/@pr\/5\/outputs\/report\.pdf"/);
  assert.match(render({ kind: 'main' }), /href="\/raw\/@main\/outputs\/report\.pdf"/);
  const local = render({ kind: 'local' });
  assert.match(local, /href="\/raw\/outputs\/report\.pdf"/);
  assert.ok(!local.includes('/raw/@'), local);
});
