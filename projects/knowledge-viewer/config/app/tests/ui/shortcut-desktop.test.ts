// 폰·태블릿엔 Shift·Space·호버가 없다: 그래프 그룹의 그 행만 도움말에 "데스크톱" 이 붙는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import { SHORTCUTS } from '../../src/app/shortcuts.ts';

const { ShortcutHelp } = await import('../../src/app/ShortcutHelp.tsx');
const noop = () => {};

test('데스크톱 전용은 지도의 Shift·Space·호버 셋뿐이다', () => {
  assert.deepEqual(
    SHORTCUTS.filter((s) => s.desktopOnly).map((s) => s.id),
    ['graph.pan', 'graph.reset', 'graph.hover'],
  );
});

test('도움말: 데스크톱 전용 행에만 "데스크톱" 표시', () => {
  const html = renderToStaticMarkup(createElement(ShortcutHelp, { platform: 'mac', choice: 'auto', detected: 'mac', onChoice: noop, onClose: noop }));
  const rows = [...html.matchAll(/<tr data-shortcut="([^"]+)">(.*?)<\/tr>/g)];
  assert.equal(rows.length, SHORTCUTS.length);
  for (const [, id, body] of rows) {
    const desktop = SHORTCUTS.find((s) => s.id === id)?.desktopOnly === true;
    assert.equal(body!.includes('kbd-help-desktop'), desktop, id);
  }
});
