// 지도 설정: 제목 표시·움직임·감쇠 — 기본값, 저장값 되읽기, 모르는 값은 기본으로.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withStorage, withThrowingStorage } from '../helpers/fake-storage.ts';
import {
  readGraphCluster,
  readGraphDamping,
  readGraphLabels,
  readGraphMotion,
  readGraphRotate,
  writeGraphCluster,
  writeGraphDamping,
  writeGraphLabels,
  writeGraphMotion,
  writeGraphRotate,
} from '../../src/app/prefs/graph.ts';

test('지도 제목 표시는 기본 major, 저장값을 읽고, 모르는 값은 기본으로', () => {
  const store = new Map<string, string>();
  withStorage(store, () => {
    assert.equal(readGraphLabels(), 'major');
    writeGraphLabels('none');
    assert.equal(store.get('knowledge-viewer.graph-labels'), 'none');
    assert.equal(readGraphLabels(), 'none');
    store.set('knowledge-viewer.graph-labels', 'bogus');
    assert.equal(readGraphLabels(), 'major');
  });
});

test('localStorage 가 던지면 기본 major', () => {
  withThrowingStorage(() => {
    assert.equal(readGraphLabels(), 'major');
    assert.doesNotThrow(() => writeGraphLabels('all'));
  });
});

test('지도 움직임은 기본 smooth, 저장값을 읽고, 모르는 값은 기본으로', () => {
  const store = new Map<string, string>();
  withStorage(store, () => {
    assert.equal(readGraphMotion(), 'smooth');
    writeGraphMotion('instant');
    assert.equal(store.get('knowledge-viewer.graph-motion'), 'instant');
    assert.equal(readGraphMotion(), 'instant');
    store.set('knowledge-viewer.graph-motion', 'bogus');
    assert.equal(readGraphMotion(), 'smooth');
  });
});

test('감쇠 강도는 기본 medium, 저장값을 읽고, 모르는 값은 기본으로', () => {
  const store = new Map<string, string>();
  withStorage(store, () => {
    assert.equal(readGraphDamping(), 'medium');
    writeGraphDamping('strong');
    assert.equal(store.get('knowledge-viewer.graph-damping'), 'strong');
    assert.equal(readGraphDamping(), 'strong');
    store.set('knowledge-viewer.graph-damping', '0.5');
    assert.equal(readGraphDamping(), 'medium');
  });
});

test('localStorage 가 던져도 움직임·감쇠는 기본값이고 쓰기는 조용히 넘어간다', () => {
  withThrowingStorage(() => {
    assert.equal(readGraphMotion(), 'smooth');
    assert.equal(readGraphDamping(), 'medium');
    assert.doesNotThrow(() => writeGraphMotion('instant'));
    assert.doesNotThrow(() => writeGraphDamping('weak'));
  });
});

test('묶음은 기본 meta, 회전은 기본 off — 저장값을 읽고 모르는 값은 기본으로', () => {
  const store = new Map<string, string>();
  withStorage(store, () => {
    assert.equal(readGraphCluster(), 'meta');
    assert.equal(readGraphRotate(), 'off');
    writeGraphCluster('community');
    writeGraphRotate('auto');
    assert.equal(store.get('knowledge-viewer.graph-cluster'), 'community');
    assert.equal(store.get('knowledge-viewer.graph-rotate'), 'auto');
    assert.equal(readGraphCluster(), 'community');
    assert.equal(readGraphRotate(), 'auto');
    store.set('knowledge-viewer.graph-cluster', 'bogus');
    store.set('knowledge-viewer.graph-rotate', 'spin');
    assert.equal(readGraphCluster(), 'meta');
    assert.equal(readGraphRotate(), 'off');
  });
});
