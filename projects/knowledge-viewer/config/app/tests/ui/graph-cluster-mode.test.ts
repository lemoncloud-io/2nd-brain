// 묶음 기준(순수): 모드 판정과 2D 묶음 이름 표시 규칙.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CLUSTER_MODES, DEFAULT_CLUSTER_MODE, clusterModes, effectiveClusterMode, isClusterMode, showClusterLabels } from '../../src/graph/cluster-mode.ts';

test('isClusterMode·기본값', () => {
  assert.equal(DEFAULT_CLUSTER_MODE, 'meta');
  assert.deepEqual(CLUSTER_MODES.map((m) => m.mode), ['meta', 'community', 'none']);
  assert.equal(isClusterMode('community'), true);
  assert.equal(isClusterMode('x'), false);
});

test('showClusterLabels: 제목 없음이면 숨기고, 묶음이 메타일 때만 그린다(이름이 메타 키라서)', () => {
  assert.equal(showClusterLabels('major', 'meta'), true);
  assert.equal(showClusterLabels('all', 'meta'), true);
  assert.equal(showClusterLabels('none', 'meta'), false);
  assert.equal(showClusterLabels('major', 'community'), false);
  assert.equal(showClusterLabels('major', 'none'), false);
});

test('clusterModes: 서버가 임베딩을 쓸 수 있다고 알릴 때만 넷째 항목 임베딩(커뮤니티 뒤)', () => {
  assert.deepEqual(clusterModes(false).map((m) => m.mode), ['meta', 'community', 'none']);
  assert.deepEqual(clusterModes(true).map((m) => m.mode), ['meta', 'community', 'embedding', 'none']);
  assert.equal(clusterModes(true)[2]!.label, '임베딩');
  assert.equal(isClusterMode('embedding'), true);
});

test('effectiveClusterMode: 임베딩을 골랐어도 군집이 없으면 메타로 돌아간다', () => {
  assert.equal(effectiveClusterMode('embedding', false), 'meta');
  assert.equal(effectiveClusterMode('embedding', true), 'embedding');
  assert.equal(effectiveClusterMode('community', false), 'community');
});

test('showClusterLabels: 임베딩 군집 이름도 그리고, 제목 없음이면 숨긴다', () => {
  assert.equal(showClusterLabels('major', 'embedding'), true);
  assert.equal(showClusterLabels('none', 'embedding'), false);
});
