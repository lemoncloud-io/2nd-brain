// 카메라 움직임의 순수 규칙 — 감쇠·스프링·로그 확대·속도 측정·설정 합치기.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FRAME_MS,
  TRANSITION_MS,
  clampDt,
  dampingOf,
  decayOver,
  decayVelocity,
  glideDistance,
  homeDistance,
  homeZoom,
  impulseFor,
  isDampingLevel,
  isMotionMode,
  omegaFor,
  pushSample,
  resolveMotion,
  settled,
  springStep,
  trackballDampingFactor,
  trackballZoomSpeed,
  velocityOf,
  wheelLogDelta,
  zoomAbout,
  zoomBy,
} from '../../src/graph/motion.ts';
import type { Sample, Spring } from '../../src/graph/motion.ts';

const near = (actual: number, expected: number, eps = 1e-9) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≉ ${expected}`);

test('설정 값: 모드·강도 판정과 감쇠 계수 0.95/0.92/0.85', () => {
  assert.equal(isMotionMode('smooth'), true);
  assert.equal(isMotionMode('instant'), true);
  assert.equal(isMotionMode('fast'), false);
  assert.equal(isDampingLevel('weak'), true);
  assert.equal(isDampingLevel('none'), false);
  assert.equal(dampingOf('weak'), 0.95);
  assert.equal(dampingOf('medium'), 0.92);
  assert.equal(dampingOf('strong'), 0.85);
});

test('resolveMotion: 바로 모드나 reduced-motion 이면 관성·전환이 없다', () => {
  assert.deepEqual(resolveMotion('smooth', 'medium', false), { smooth: true, damping: 0.92, transitionMs: TRANSITION_MS });
  assert.deepEqual(resolveMotion('instant', 'medium', false), { smooth: false, damping: 0.92, transitionMs: 0 });
  assert.deepEqual(resolveMotion('smooth', 'weak', true), { smooth: false, damping: 0.95, transitionMs: 0 });
});

test('decayOver: 한 프레임이면 damping 그대로, dt 를 쪼개도 같은 시간 뒤 같은 값', () => {
  near(decayOver(0.92, FRAME_MS), 0.92);
  near(decayOver(0.92, 2 * FRAME_MS), 0.92 * 0.92);
  // 33 ms 한 번 = 16.7 ms 두 번 (30 fps 와 60 fps 가 같은 시간 뒤 같은 속도)
  near(decayOver(0.85, 33.4), decayOver(0.85, 16.7) * decayOver(0.85, 16.7));
  assert.equal(decayOver(0.92, 0), 1);
});

test('decayVelocity: 임계 아래로 내려가면 정확히 0 이 된다', () => {
  let v = 1;
  let frames = 0;
  while (v !== 0 && frames < 10_000) {
    v = decayVelocity(v, 0.92, FRAME_MS, 1e-3);
    frames += 1;
  }
  assert.equal(v, 0);
  // 0.92^n < 1e-3 → n ≈ 83 프레임(1.4 초)
  assert.ok(frames > 70 && frames < 100, `frames ${frames}`);
  // 약한 감쇠가 더 오래 간다
  let w = 1;
  let wf = 0;
  while (w !== 0) {
    w = decayVelocity(w, 0.95, FRAME_MS, 1e-3);
    wf += 1;
  }
  assert.ok(wf > frames);
});

test('glideDistance ↔ impulseFor 는 서로 역이고, 프레임 합과 맞는다', () => {
  const v0 = impulseFor(100, 0.92);
  near(glideDistance(v0, 0.92), 100);
  // 실제로 프레임마다 가 보면 같은 거리다(임계 없이).
  let v = v0;
  let gone = 0;
  for (let i = 0; i < 2000; i += 1) {
    gone += v * FRAME_MS;
    v *= 0.92;
  }
  near(gone, 100, 1e-6);
});

test('trackballDampingFactor: f = 1 − decay², 느린 프레임일수록 크다, [0, 1] 안', () => {
  near(trackballDampingFactor(0.92), 1 - 0.92 * 0.92);
  assert.ok(trackballDampingFactor(0.92, 33) > trackballDampingFactor(0.92, 16.7));
  assert.equal(trackballDampingFactor(0.92, 0), 0);
  assert.ok(trackballDampingFactor(0.5, 1000) <= 1);
});

test('trackballZoomSpeed: 부드럽게는 기본 1.2, 바로는 1/f 배라 휠 한 번의 거리가 같다', () => {
  near(trackballZoomSpeed(true, 0.92), 1.2);
  const f = trackballDampingFactor(0.92);
  near(trackballZoomSpeed(false, 0.92), 1.2 / f);
  // 잔여 d 가 프레임마다 (1−f) 로 줄며 zoomSpeed·잔여 를 더하면 합이 zoomSpeed·d/f — 바로 모드의 한 걸음과 같다.
  const d = 0.025;
  let rest = d;
  let total = 0;
  for (let i = 0; i < 2000; i += 1) {
    total += trackballZoomSpeed(true, 0.92) * rest;
    rest *= 1 - f;
  }
  near(total, trackballZoomSpeed(false, 0.92) * d, 1e-9);
});

test('wheelLogDelta: d3-zoom 기본과 같은 거리(2^(−deltaY·0.002)), 줄·페이지 단위, Ctrl 10 배', () => {
  near(wheelLogDelta(100, 0), -100 * 0.002 * Math.LN2);
  near(Math.exp(wheelLogDelta(-100, 0)), Math.pow(2, 0.2));
  near(wheelLogDelta(3, 1), -3 * 0.05 * Math.LN2);
  near(wheelLogDelta(1, 2), -Math.LN2);
  near(wheelLogDelta(100, 0, true), 10 * wheelLogDelta(100, 0));
});

test('zoomBy: 로그 공간이라 같은 속도는 어느 배율에서든 같은 비율', () => {
  near(zoomBy(1, 0.01, 100) / 1, zoomBy(8, 0.01, 100) / 8);
  near(zoomBy(2, 0, 100), 2);
  near(zoomBy(2, Math.LN2 / 100, 100), 4);
});

test('zoomAbout: 포인터 아래 그래프 좌표가 확대 뒤에도 그대로다', () => {
  // 중심 (10, 20), 포인터 그래프 좌표 (30, 50), 배율 1 → 2
  const c2 = zoomAbout({ x: 10, y: 20 }, { x: 30, y: 50 }, 1, 2);
  // 화면 좌표 = (g − c)·k. 포인터: (20, 30)·1 = (20, 30) 이어야 하고 새 중심에서도 (30 − c2.x)·2 = 20.
  near((30 - c2.x) * 2, 20);
  near((50 - c2.y) * 2, 30);
  // 배율이 같으면 중심도 같다.
  assert.deepEqual(zoomAbout({ x: 1, y: 2 }, { x: 9, y: 9 }, 3, 3), { x: 1, y: 2 });
});

test('velocityOf: 창 안 첫·끝 표본의 기울기, 멈췄다 놓거나 배율이 바뀌면 0', () => {
  const s = (t: number, x: number, k = 1): Sample => ({ t, x, y: 2 * x, k });
  const samples = [s(0, 0), s(16, 16), s(32, 32), s(48, 48)];
  assert.deepEqual(velocityOf(samples, 50), { x: 1, y: 2 });
  // 마지막 표본이 오래됐다 — 손을 멈춘 뒤 놓았다.
  assert.deepEqual(velocityOf(samples, 48 + 200), { x: 0, y: 0 });
  // 표본 하나
  assert.deepEqual(velocityOf([s(0, 0)], 1), { x: 0, y: 0 });
  // 배율이 바뀌었다(확대 중)
  assert.deepEqual(velocityOf([s(0, 0, 1), s(16, 16, 2)], 20), { x: 0, y: 0 });
  // 창(120 ms) 밖의 옛 표본은 안 쓴다 — 느렸다가 빨라진 드래그는 최근 속도다.
  const accel = [s(0, 0), s(500, 10), s(560, 70), s(620, 130)];
  assert.deepEqual(velocityOf(accel, 625), { x: 1, y: 2 });
});

test('pushSample: 끝에 더하고 MAX_SAMPLES 로 자르며 입력은 그대로', () => {
  const s = (t: number): Sample => ({ t, x: 0, y: 0, k: 1 });
  let list: Sample[] = [];
  for (let i = 0; i < 20; i += 1) list = pushSample(list, s(i));
  assert.equal(list.length, 8);
  assert.equal(list[0]!.t, 12);
  assert.equal(list[7]!.t, 19);
  const src = [s(1)];
  pushSample(src, s(2));
  assert.equal(src.length, 1);
});

test('springStep: 오버슈트 없이 목표에 닿고, dt 를 쪼개도 같은 시간 뒤 같은 값', () => {
  const omega = omegaFor(TRANSITION_MS);
  let s: Spring = { x: 0, v: 0 };
  let prev = 0;
  for (let t = 0; t < 2000; t += FRAME_MS) {
    s = springStep(s, 100, FRAME_MS, omega);
    assert.ok(s.x <= 100 + 1e-9, `overshoot ${s.x}`);
    assert.ok(s.x >= prev - 1e-9, `backwards ${prev} → ${s.x}`);
    prev = s.x;
  }
  near(s.x, 100, 1e-6);
  // 전환 시간 뒤 남은 거리는 1 % 다.
  let u: Spring = { x: 0, v: 0 };
  for (let t = 0; t < TRANSITION_MS - 1e-9; t += 1) u = springStep(u, 100, 1, omega);
  near(100 - u.x, 1, 0.05);
  // 600 ms 한 번 = 1 ms × 600 (해석해)
  const once = springStep({ x: 0, v: 0 }, 100, TRANSITION_MS, omega);
  near(once.x, u.x, 1e-6);
  near(once.v, u.v, 1e-9);
});

test('springStep: 출발 속도가 목표 쪽이면 더 빠르고, 큰 속도는 한 번만 넘어가고 되돌아온다(진동 없음)', () => {
  const omega = omegaFor(TRANSITION_MS);
  const still = springStep({ x: 0, v: 0 }, 100, 100, omega);
  const toward = springStep({ x: 0, v: 0.5 }, 100, 100, omega);
  assert.ok(toward.x > still.x);
  // 임계 감쇠는 큰 출발 속도로 목표를 한 번 지나칠 수는 있어도 진동하지 않는다 — 목표를 가로지르는 횟수는 1 이하다.
  let s: Spring = { x: 0, v: 2 };
  let crossings = 0;
  let side = Math.sign(s.x - 100);
  for (let t = 0; t < 3000; t += 5) {
    s = springStep(s, 100, 5, omega);
    const now = Math.sign(s.x - 100);
    if (now !== 0 && now !== side) {
      crossings += 1;
      side = now;
    }
  }
  assert.ok(crossings <= 1, `crossings ${crossings}`);
  near(s.x, 100, 1e-6);
});

test('settled: 거리와 속도가 남길 거리 둘 다 eps 안이어야 한다', () => {
  const omega = omegaFor(TRANSITION_MS);
  assert.equal(settled({ x: 99.9, v: 0 }, 100, omega, 0.5), true);
  assert.equal(settled({ x: 99.9, v: 1 }, 100, omega, 0.5), false);
  assert.equal(settled({ x: 90, v: 0 }, 100, omega, 0.5), false);
});

test('clampDt: 음수는 0, 긴 멈춤은 MAX_DT_MS 로', () => {
  assert.equal(clampDt(-5), 0);
  assert.equal(clampDt(16), 16);
  assert.equal(clampDt(5000), 100);
});

test('homeDistance·homeZoom: 라이브러리의 첫 보기와 같은 식, 0 노드도 안전', () => {
  near(homeDistance(8), 2 * 170);
  near(homeDistance(0), 170);
  near(homeZoom(8), 2);
  near(homeZoom(0), 4);
});
