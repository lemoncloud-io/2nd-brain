// 소스 바꾸는 중 표시의 순수 규칙(source-switch.ts)과 저장소(useSourceSwitch.ts), 덮개 SSR(SwitchingVeil.tsx).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import type { Source } from '../../shared/source.ts';

const {
  contentArrived,
  EMPTY_SNAP,
  expireSwitch,
  finishSwitch,
  IDLE_SWITCH,
  isEmptySnap,
  startSwitch,
  switchLabel,
  SWITCH_TIMEOUT_MS,
} = await import('../../src/app/source-switch.ts');
const { beginSourceSwitch, getSourceSwitch } = await import('../../src/app/useSourceSwitch.ts');
const { SwitchingVeil } = await import('../../src/app/SwitchingVeil.tsx');

const PR = (number: number): Source => ({ kind: 'pr', number });
const MAIN: Source = { kind: 'main' };
const LOCAL: Source = { kind: 'local' };

test('switchLabel: PR 은 번호, main·local 은 이름', () => {
  assert.equal(switchLabel(PR(123)), 'PR #123 불러오는 중…');
  assert.equal(switchLabel(MAIN), '메인 불러오는 중…');
  assert.equal(switchLabel(LOCAL), '로컬 불러오는 중…');
});

test('startSwitch → finishSwitch: 시작하면 active, 같은 id 로 끝내면 비운다', () => {
  const s = startSwitch(IDLE_SWITCH, 'main', PR(7), 100);
  assert.ok(s.active !== null);
  assert.equal(s.active.id, 1);
  assert.equal(s.active.to, 'pr:7');
  assert.equal(s.active.from, 'main');
  assert.equal(s.active.label, 'PR #7 불러오는 중…');
  assert.equal(s.active.arrived, false);
  const done = finishSwitch(s, 1);
  assert.equal(done.active, null);
  assert.equal(done.seq, 1);
});

test('startSwitch: 지금 소스와 같으면 시작하지 않는다', () => {
  assert.equal(startSwitch(IDLE_SWITCH, 'pr:7', PR(7), 100), IDLE_SWITCH);
});

test('startSwitch: 같은 곳으로 가는 중이면 그 전환을 두고, arrived 만 올린다', () => {
  const s = startSwitch(IDLE_SWITCH, 'main', PR(7), 100);
  assert.equal(startSwitch(s, 'main', PR(7), 200), s);
  const arrived = startSwitch(s, 'main', PR(7), 300, true);
  assert.equal(arrived.active?.id, 1);
  assert.equal(arrived.active?.startedAt, 100);
  assert.equal(arrived.active?.arrived, true);
});

test('startSwitch: 더 새 전환이 옛 것을 갈아 끼우고, 옛 id 의 끝 요청은 버린다', () => {
  const a = startSwitch(IDLE_SWITCH, 'main', PR(7), 100);
  const b = startSwitch(a, 'main', LOCAL, 150);
  assert.equal(b.active?.id, 2);
  assert.equal(b.active?.label, '로컬 불러오는 중…');
  assert.equal(finishSwitch(b, 1), b);
  assert.equal(finishSwitch(b, 2).active, null);
  // 끝난 뒤 늦게 온 끝 요청도 버린다.
  const idle = finishSwitch(b, 2);
  assert.equal(finishSwitch(idle, 2), idle);
});

test('expireSwitch: 안전 시간이 지나야 끝낸다', () => {
  const s = startSwitch(IDLE_SWITCH, 'main', PR(7), 1000);
  assert.equal(expireSwitch(s, 1000 + SWITCH_TIMEOUT_MS - 1), s);
  assert.equal(expireSwitch(s, 1000 + SWITCH_TIMEOUT_MS).active, null);
  assert.equal(expireSwitch(IDLE_SWITCH, 1e12), IDLE_SWITCH);
  assert.equal(SWITCH_TIMEOUT_MS, 20_000);
});

test('contentArrived: 옛 내용과 다른 문서·폴더·오류가 차야 왔다', () => {
  const oldDoc = { source: 'main' };
  const stale = { doc: oldDoc, folder: null, error: null };
  assert.equal(contentArrived(stale, stale), false);
  assert.equal(contentArrived(stale, EMPTY_SNAP), false);
  assert.equal(contentArrived(stale, { doc: { source: 'pr:7' }, folder: null, error: null }), true);
  assert.equal(contentArrived(EMPTY_SNAP, { doc: null, folder: { dir: 'a', entries: [] }, error: null }), true);
  assert.equal(contentArrived({ doc: null, folder: null, error: 'x' }, { doc: null, folder: null, error: 'x' }), false);
  assert.equal(contentArrived(EMPTY_SNAP, { doc: null, folder: null, error: 'x' }), true);
  assert.equal(isEmptySnap(EMPTY_SNAP), true);
  assert.equal(isEmptySnap(stale), false);
});

test('beginSourceSwitch: 저장소에 PR 전환을 시작한다', () => {
  beginSourceSwitch(PR(123));
  const a = getSourceSwitch().active;
  assert.equal(a?.to, 'pr:123');
  assert.equal(a?.label, 'PR #123 불러오는 중…');
});

test('SwitchingVeil: 쉬는 동안은 덮개·글이 없고, 켜지면 글이 role=status 에 든다', () => {
  const idle = renderToStaticMarkup(createElement(SwitchingVeil, { active: null }));
  assert.ok(idle.includes('class="switching-veil" data-on="false"'), idle);
  assert.ok(!idle.includes('불러오는 중'), idle);
  assert.ok(!idle.includes('switching-spinner'), idle);

  const active = startSwitch(IDLE_SWITCH, 'main', PR(123), 0).active;
  // 기본은 250ms 뒤에야 켠다 — 첫 그리기(SSR)에는 꺼져 있다.
  const early = renderToStaticMarkup(createElement(SwitchingVeil, { active }));
  assert.ok(early.includes('data-on="false"'), early);
  assert.ok(!early.includes('PR #123'), early);

  const on = renderToStaticMarkup(createElement(SwitchingVeil, { active, delayMs: 0 }));
  assert.ok(on.includes('class="switching-veil" data-on="true"'), on);
  assert.ok(on.includes('class="switching-bar" data-on="true"'), on);
  assert.match(on, /role="status" aria-live="polite">PR #123 불러오는 중…</);
  assert.ok(on.includes('switching-spinner'), on);
  // 덮개는 초점을 받지 않는다.
  assert.ok(!on.includes('tabindex'), on);
});
