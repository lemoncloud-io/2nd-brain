// 지도 입력의 순수 규칙 — Shift·Space 키 상태 머신, 호버 간선 판정, 초기 보기 목표.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HOVER_LINK_WIDTH_SCALE,
  HOVER_OTHER_ALPHA,
  INITIAL_KEYS,
  isTypingTarget,
  keyStep,
  linkHover,
  linksByNode,
  resetView2d,
  resetView3d,
  touches,
} from '../../src/graph/interaction.ts';
import { homeDistance, homeZoom } from '../../src/graph/motion.ts';

test('keyStep: Shift 는 keydown 에 켜고 keyup·blur 에 끈다', () => {
  let s = keyStep(INITIAL_KEYS, { type: 'keydown', key: 'Shift', typing: false });
  assert.deepEqual(s, { state: { shift: true }, reset: false });
  s = keyStep(s.state, { type: 'keyup', key: 'Shift', typing: false });
  assert.equal(s.state.shift, false);
  s = keyStep({ shift: true }, { type: 'blur' });
  assert.equal(s.state.shift, false);
  // 다른 키는 상태를 바꾸지 않는다
  s = keyStep({ shift: true }, { type: 'keydown', key: 'a', typing: false });
  assert.deepEqual(s, { state: { shift: true }, reset: false });
});

test('keyStep: Space 는 입력 상자 밖에서만 초기 보기, 상태는 그대로', () => {
  assert.deepEqual(keyStep({ shift: false }, { type: 'keydown', key: ' ', typing: false }), { state: { shift: false }, reset: true });
  assert.equal(keyStep({ shift: false }, { type: 'keydown', key: 'Spacebar', typing: false }).reset, true);
  assert.equal(keyStep({ shift: false }, { type: 'keydown', key: ' ', typing: true }).reset, false);
  // 입력 상자에서는 Shift 도 글자다
  assert.equal(keyStep({ shift: false }, { type: 'keydown', key: 'Shift', typing: true }).state.shift, false);
});

test('keyStep: 마우스 이벤트의 shiftKey 는 켜기만 한다 — 끄는 것은 keyup·blur', () => {
  const s = { shift: false };
  assert.equal(keyStep(s, { type: 'pointer', shiftKey: false }).state, s);
  assert.equal(keyStep(s, { type: 'pointer', shiftKey: true }).state.shift, true);
  const on = { shift: true };
  assert.equal(keyStep(on, { type: 'pointer', shiftKey: false }).state, on);
  assert.equal(keyStep(on, { type: 'pointer', shiftKey: true }).state, on);
});

test('isTypingTarget: input·textarea·select·contentEditable 만', () => {
  assert.equal(isTypingTarget('INPUT'), true);
  assert.equal(isTypingTarget('textarea'), true);
  assert.equal(isTypingTarget('SELECT'), true);
  assert.equal(isTypingTarget('DIV', true), true);
  assert.equal(isTypingTarget('DIV'), false);
  assert.equal(isTypingTarget('BUTTON'), false);
  assert.equal(isTypingTarget(null), false);
});

test('touches·linkHover: 간선 끝이 문자열이든 노드 객체든 경로로 본다', () => {
  const l1 = { source: 'a', target: { path: 'b' } };
  const l2 = { source: { path: 'c' }, target: 'd' };
  assert.equal(touches(l1, 'a'), true);
  assert.equal(touches(l1, 'b'), true);
  assert.equal(touches(l1, 'c'), false);
  assert.equal(linkHover(l1, null), 'none');
  assert.equal(linkHover(l1, 'b'), 'on');
  assert.equal(linkHover(l2, 'b'), 'off');
  assert.equal(HOVER_LINK_WIDTH_SCALE, 2);
  assert.equal(HOVER_OTHER_ALPHA, 0.25);
});

test('linksByNode: 노드마다 닿은 간선, 자기 고리는 한 번만', () => {
  const ab = { source: 'a', target: 'b' };
  const bc = { source: 'b', target: { path: 'c' } };
  const aa = { source: 'a', target: 'a' };
  const m = linksByNode([ab, bc, aa]);
  assert.deepEqual(m.get('a'), [ab, aa]);
  assert.deepEqual(m.get('b'), [ab, bc]);
  assert.deepEqual(m.get('c'), [bc]);
  assert.equal(m.get('z'), undefined);
});

test('resetView3d·resetView2d: 라이브러리의 첫 보기와 같은 자리', () => {
  assert.deepEqual(resetView3d(8), { position: [0, 0, homeDistance(8)], lookAt: [0, 0, 0], up: [0, 1, 0] });
  assert.deepEqual(resetView2d(8), { center: [0, 0], zoom: homeZoom(8) });
});
