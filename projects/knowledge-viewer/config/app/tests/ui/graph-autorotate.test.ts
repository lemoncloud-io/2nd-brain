// 자동 회전 규칙: 유휴 뒤에만, 입력이 오면 멈추고 다시 세며, 막히면 0, 램프로 시작한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IDLE_MS, INITIAL_ROTATE, RAMP_MS, ROTATE_SPEED, canSpin, isRotateMode, markInput, rotateStep } from '../../src/graph/autorotate.ts';

const on = { ...INITIAL_ROTATE, enabled: true };

test('꺼져 있으면 돌지 않는다', () => {
  assert.equal(canSpin(INITIAL_ROTATE, 1000, false), false);
  assert.equal(rotateStep(INITIAL_ROTATE, 1000, 16, false).angle, 0);
});

test('입력이 없었으면 바로 돌고, 램프가 끝나면 각속도 × dt 다', () => {
  let s = on;
  const r1 = rotateStep(s, 0, 16, false);
  s = r1.state;
  assert.equal(r1.angle, 0, '램프 시작점은 0');
  const r2 = rotateStep(s, RAMP_MS, 16, false);
  assert.ok(Math.abs(r2.angle - ROTATE_SPEED * 0.016) < 1e-9);
  const r3 = rotateStep(r2.state, RAMP_MS * 2, 1000, false);
  assert.ok(Math.abs(r3.angle - ROTATE_SPEED) < 1e-9, '1초면 각속도만큼');
});

test('입력 뒤 IDLE_MS 안에는 멈추고, 지나면 다시 램프부터 돈다', () => {
  let s = rotateStep(on, 5000, 16, false).state;
  s = markInput(s, 6000);
  assert.equal(s.spinningSince, null);
  assert.equal(canSpin(s, 6000 + IDLE_MS - 1, false), false);
  assert.equal(rotateStep(s, 6000 + IDLE_MS - 1, 16, false).angle, 0);
  const r = rotateStep(s, 6000 + IDLE_MS, 16, false);
  assert.equal(r.angle, 0, '다시 돌 때도 램프 시작점은 0');
  assert.equal(r.state.spinningSince, 6000 + IDLE_MS);
});

test('막히면(호버·전환·바로 모드) 0 이고 돌던 상태를 비운다', () => {
  const spinning = rotateStep(on, 0, 16, false).state;
  const r = rotateStep(spinning, 100, 16, true);
  assert.equal(r.angle, 0);
  assert.equal(r.state.spinningSince, null);
});

test('isRotateMode', () => {
  assert.equal(isRotateMode('auto'), true);
  assert.equal(isRotateMode('off'), true);
  assert.equal(isRotateMode('spin'), false);
});
