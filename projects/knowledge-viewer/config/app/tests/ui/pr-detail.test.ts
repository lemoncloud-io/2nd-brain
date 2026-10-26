import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nextChangedIndex } from '../../src/panels/pr-detail.ts';
import { prBadgeHead, prBadgeText, prTooltip } from '../../src/app/source-ui.ts';
import { loadPrefs, visiblePanels } from '../../src/panels/prefs.ts';
import type { PrChanges } from '../../src/app/types.ts';

const P = [10, 50, 90];

test('nextChangedIndex: 지금 위치에서 다음·이전', () => {
  assert.equal(nextChangedIndex(P, 50, 1), 2);
  assert.equal(nextChangedIndex(P, 50, -1), 0);
});

test('nextChangedIndex: 끝에서 순환한다', () => {
  assert.equal(nextChangedIndex(P, 90, 1), 0);
  assert.equal(nextChangedIndex(P, 10, -1), 2);
  assert.equal(nextChangedIndex(P, 100, 1), 0);
  assert.equal(nextChangedIndex(P, 0, -1), 2);
});

test('nextChangedIndex: 위치 사이에서는 가까운 앞뒤', () => {
  assert.equal(nextChangedIndex(P, 30, 1), 1);
  assert.equal(nextChangedIndex(P, 30, -1), 0);
  assert.equal(nextChangedIndex(P, 0, 1), 0);
});

test('nextChangedIndex: 빈 목록은 -1', () => {
  assert.equal(nextChangedIndex([], 0, 1), -1);
  assert.equal(nextChangedIndex([], 0, -1), -1);
});

const changes = (title: string): PrChanges => ({
  number: 927,
  title,
  author: 'steve',
  head: 'feat/x',
  base: 'master',
  headOid: '0123456789abcdef0123',
  updatedAt: '2026-10-23T00:00:00Z',
  url: 'https://github.com/o/r/pull/927',
  baseOid: 'b',
  mergeBase: 'm',
  headCommit: '0123456789abcdef0123',
  files: [],
});

test('prBadgeText: PR 번호와 제목, 제목은 40 코드포인트에서 자른다', () => {
  assert.equal(prBadgeText(changes('짧은 제목')), 'PR #927 · 짧은 제목');
  const long = '한'.repeat(45);
  assert.equal(prBadgeText(changes(long)), `PR #927 · ${'한'.repeat(40)}…`);
  assert.equal(prBadgeText(changes('가'.repeat(40))), `PR #927 · ${'가'.repeat(40)}`);
  // 서로게이트 짝(이모지)도 한 글자로 센다.
  assert.equal(prBadgeText(changes('😀'.repeat(41))), `PR #927 · ${'😀'.repeat(40)}…`);
});

test('prBadgeHead: 읽은 커밋(headCommit) 앞 7자', () => {
  assert.equal(prBadgeHead(changes('t')), '0123456');
  assert.equal(prBadgeHead({ ...changes('t'), headCommit: 'fedcba9876' }), 'fedcba9');
});

test('prTooltip: 작성자 · head → base · 읽은 커밋 앞 8자', () => {
  assert.equal(prTooltip(changes('t')), 'steve · feat/x → master · 01234567');
  assert.equal(prTooltip({ ...changes('t'), headCommit: 'fedcba9876' }), 'steve · feat/x → master · fedcba98');
});

test('prdetail 패널: 그 패널이 생기기 전에 저장한 설정에서도 켜져 보인다', () => {
  const panels = [{ id: 'meta' }, { id: 'prdetail' }, { id: 'toc' }];
  const saved = JSON.stringify({ order: ['toc', 'meta'], off: [] });
  const prefs = loadPrefs(panels, { getItem: () => saved });
  assert.ok(visiblePanels(panels, prefs).some((p) => p.id === 'prdetail'));
});
