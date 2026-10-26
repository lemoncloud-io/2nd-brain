// 좁은 폭 서랍: 한 번에 하나, 같은 쪽은 닫기, 다른 쪽은 바꾸기. 앱 루트 class 는 접힘과 서랍을 같이 싣는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { appClassName, drawerReducer, NARROW_QUERY } from '../../src/app/useDrawer.ts';

test('서랍: 닫힌 상태에서 누르면 그쪽이 열린다', () => {
  assert.equal(drawerReducer(null, { type: 'toggle', side: 'left' }), 'left');
  assert.equal(drawerReducer(null, { type: 'toggle', side: 'right' }), 'right');
});

test('서랍: 같은 쪽을 다시 누르면 닫히고, 다른 쪽을 누르면 그쪽으로 바뀐다', () => {
  assert.equal(drawerReducer('left', { type: 'toggle', side: 'left' }), null);
  assert.equal(drawerReducer('left', { type: 'toggle', side: 'right' }), 'right');
  assert.equal(drawerReducer('right', { type: 'toggle', side: 'left' }), 'left');
});

test('서랍: close 는 어느 상태에서든 닫는다', () => {
  for (const s of ['left', 'right', null] as const) assert.equal(drawerReducer(s, { type: 'close' }), null);
});

test('앱 class: 서랍이 열리면 app-drawer-<쪽>, 닫히면 없다', () => {
  const base = { agent: false, leftOpen: true, rightOpen: true };
  assert.equal(appClassName({ ...base, drawer: null }), 'app');
  assert.equal(appClassName({ ...base, drawer: 'left' }), 'app app-drawer-left');
  assert.equal(appClassName({ ...base, drawer: 'right' }), 'app app-drawer-right');
});

test('앱 class: 넓은 폭 접힘(저장값)과 서랍은 따로 실린다 — 접힌 열도 서랍으로 열린다', () => {
  assert.equal(
    appClassName({ agent: false, leftOpen: false, rightOpen: false, drawer: 'left' }),
    'app app-right-collapsed app-left-collapsed app-drawer-left',
  );
  assert.equal(appClassName({ agent: true, leftOpen: true, rightOpen: true, drawer: null }), 'app app-agent');
});

test('서랍 경계는 mobile.css 의 미디어 쿼리와 같다', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../../src/styles/mobile.css', import.meta.url), 'utf8');
  assert.ok(css.includes(`@media ${NARROW_QUERY}`), NARROW_QUERY);
  assert.ok(css.includes('@media (max-width: 640px)'));
});
