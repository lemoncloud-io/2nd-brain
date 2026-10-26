// 구 경위선 궤도 장식: 격자 꼭짓점(수·반지름 위), 반지름 규칙(보통·전체 보기), 켬/끔 설정 저장.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withStorage, withThrowingStorage } from '../helpers/fake-storage.ts';
import {
  DEFAULT_ORBIT_MODE,
  ORBIT_ALL_K,
  ORBIT_MERIDIANS,
  ORBIT_NEAR_K,
  ORBIT_PARALLELS,
  ORBIT_SEGMENTS,
  isOrbitMode,
  orbitGridPositions,
  orbitRadius,
} from '../../src/graph/orbit.ts';
import { readGraphOrbit, writeGraphOrbit } from '../../src/app/prefs/graph.ts';

test('꼭짓점 수 = (경선 + 위선) × 분할 × 2 — 선분마다 두 점', () => {
  const p = orbitGridPositions(1, 12, 5, 64);
  assert.equal(p.length, (12 + 5) * 64 * 2 * 3);
  assert.equal(orbitGridPositions(1, ORBIT_MERIDIANS, ORBIT_PARALLELS, ORBIT_SEGMENTS).length / 3, 2176);
  assert.equal(orbitGridPositions(1, 0, 0, 64).length, 0);
});

test('모든 꼭짓점이 반지름 위에 있다(오차 1e-6)', () => {
  for (const r of [1, 92.5, 480]) {
    const p = orbitGridPositions(r, 12, 5, 64);
    for (let i = 0; i < p.length; i += 3) {
      const d = Math.hypot(p[i], p[i + 1], p[i + 2]);
      assert.ok(Math.abs(d - r) < 1e-6 * Math.max(1, r), `점 ${i / 3}: ${d} ≠ ${r}`);
    }
  }
});

test('경선은 극(±y)에서 만나고 위선은 ±30°·±60°·적도 높이다', () => {
  const p = orbitGridPositions(1, 12, 5, 64);
  // 경선 하나 = 64 선분 = 128 점. 첫 점은 북극, 마지막 점은 남극.
  for (let m = 0; m < 12; m++) {
    const first = m * 128 * 3;
    const last = (m * 128 + 127) * 3;
    assert.ok(Math.abs(p[first + 1] - 1) < 1e-6);
    assert.ok(Math.abs(p[last + 1] + 1) < 1e-6);
  }
  const ys = new Set<string>();
  for (let k = 0; k < 5; k++) ys.add(p[(12 * 128 + k * 128) * 3 + 1].toFixed(6));
  const want = [-60, -30, 0, 30, 60].map((deg) => Math.sin((deg * Math.PI) / 180).toFixed(6));
  assert.deepEqual([...ys].sort(), [...new Set(want)].sort());
});

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('반지름: 보통 보기는 바깥 홉 껍질의 1.15 배, 전체 보기는 고립 노드 궤도 3R', () => {
  assert.equal(ORBIT_NEAR_K, 1.15);
  assert.equal(ORBIT_ALL_K, 3);
  close(orbitRadius(100, false), 115);
  close(orbitRadius(100, true), 300);
  // 홉 껍질은 n·R — 2홉 지도의 바깥 껍질은 2R 이다.
  close(orbitRadius(100, false, 2), 230);
  close(orbitRadius(100, false, 3), 345);
  // 홉 0(중심만)이나 이상한 값은 1홉으로 본다. 전체 보기는 홉과 무관하다.
  close(orbitRadius(100, false, 0), 115);
  close(orbitRadius(100, false, Number.NaN), 115);
  close(orbitRadius(100, true, 3), 300);
});

test('궤도 설정은 기본 켬, 저장값을 읽고, 모르는 값은 기본으로', () => {
  assert.equal(DEFAULT_ORBIT_MODE, 'on');
  assert.ok(isOrbitMode('on') && isOrbitMode('off') && !isOrbitMode('auto'));
  const store = new Map<string, string>();
  withStorage(store, () => {
    assert.equal(readGraphOrbit(), 'on');
    writeGraphOrbit('off');
    assert.equal(store.get('knowledge-viewer.graph-orbit'), 'off');
    assert.equal(readGraphOrbit(), 'off');
    store.set('knowledge-viewer.graph-orbit', 'bogus');
    assert.equal(readGraphOrbit(), 'on');
  });
  withThrowingStorage(() => {
    assert.equal(readGraphOrbit(), 'on');
    assert.doesNotThrow(() => writeGraphOrbit('off'));
  });
});
