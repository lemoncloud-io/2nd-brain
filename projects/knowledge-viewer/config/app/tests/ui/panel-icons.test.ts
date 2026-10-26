// 오른쪽 열 패널 제목의 아이콘. 패널마다 아이콘이 있고, 서로 다르며, 제목 단추 안에서 캐럿과 제목 사이에 그린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';

const { PANELS } = await import('../../src/panels/registry.ts');
const { PanelHeading } = await import('../../src/panels/PanelHeading.tsx');

test('패널마다 아이콘이 있고 서로 다르다', () => {
  const marks = PANELS.map((p) => {
    assert.ok(p.icon, `${p.id} 아이콘 없음`);
    const svg = renderToStaticMarkup(createElement(p.icon));
    assert.match(svg, /^<svg class="icon"/, p.id);
    return svg;
  });
  assert.equal(new Set(marks).size, marks.length);
});

test('제목 단추: 캐럿 → 아이콘 → 제목 순, 아이콘은 aria-hidden', () => {
  const graph = PANELS.find((p) => p.id === 'graph')!;
  const h = renderToStaticMarkup(createElement(PanelHeading, { panel: graph, collapsed: true, onToggle: () => {} }));
  assert.match(h, /<button[^>]*class="panel-toggle"[^>]*aria-expanded="false"/);
  assert.match(h, /panel-caret">▸<\/span><span class="panel-icon"><svg[^>]*aria-hidden="true".*<\/svg><\/span>연결 지도<\/button>/);
});
