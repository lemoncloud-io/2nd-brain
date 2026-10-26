// 목차 점: 헤딩이 아니라 그 헤딩의 절(다음 같은·얕은 헤딩 앞까지, 없으면 끝)이 바뀌었는가.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { changedHeadings, docEndLine } from '../../src/reader/toc-changed.ts';

const H = (depth: number, line: number) => ({ depth, line });

// 1: # A(3) ─ 2: ## A1(6) ─ 3: ### A1a(9) ─ 4: ## A2(14) ─ 5: # B(20) … 끝 30
const heads = [H(1, 3), H(2, 6), H(3, 9), H(2, 14), H(1, 20)];
const END = 30;

const sorted = (s: Set<number>): number[] => [...s].sort((a, b) => a - b);

test('중첩: 깊은 절의 변경은 그 위 절들에도 점', () => {
  // 11 은 A1a(9~13) 안 → A1a·A1·A 모두. A2·B 는 아니다.
  assert.deepEqual(sorted(changedHeadings(heads, [{ start: 11, end: 11 }], [], END)), [0, 1, 2]);
  // 15 는 A2(14~19) 안 → A2·A.
  assert.deepEqual(sorted(changedHeadings(heads, [{ start: 15, end: 16 }], [], END)), [0, 3]);
});

test('마지막 절은 끝(endLine)까지', () => {
  assert.deepEqual(sorted(changedHeadings(heads, [{ start: 29, end: 30 }], [], END)), [4]);
  // 끝을 넘는 범위도 겹치면 그 절이다.
  assert.deepEqual(sorted(changedHeadings(heads, [{ start: 30, end: 40 }], [], END)), [4]);
});

test('절 안의 지운 자리(afterLine)도 점', () => {
  // 7 뒤를 지웠다 → A1(6~8)·A.
  assert.deepEqual(sorted(changedHeadings(heads, [], [{ afterLine: 7, count: 2 }], END)), [0, 1]);
  // 절 마지막 줄 뒤(다음 헤딩 바로 앞)를 지운 것도 그 절이다.
  assert.deepEqual(sorted(changedHeadings(heads, [], [{ afterLine: 19, count: 1 }], END)), [0, 3]);
  // 첫 헤딩 앞(머리말·frontmatter)을 지운 것은 어느 절도 아니다.
  assert.deepEqual(sorted(changedHeadings(heads, [], [{ afterLine: 1, count: 1 }], END)), []);
  assert.deepEqual(sorted(changedHeadings(heads, [], [{ afterLine: 0, count: 1 }], END)), []);
});

test('헤딩 줄 자체를 고친 것', () => {
  assert.deepEqual(sorted(changedHeadings(heads, [{ start: 20, end: 20 }], [], END)), [4]);
  assert.deepEqual(sorted(changedHeadings(heads, [{ start: 9, end: 9 }], [], END)), [0, 1, 2]);
});

test('첫 헤딩 앞만 바뀌었거나 변경이 없으면 빈 집합', () => {
  assert.equal(changedHeadings(heads, [{ start: 1, end: 2 }], [], END).size, 0);
  assert.equal(changedHeadings(heads, [], [], END).size, 0);
  assert.equal(changedHeadings([], [{ start: 1, end: 9 }], [], END).size, 0);
});

test('docEndLine: 본문 줄 수 + bodyStartLine - 1(마지막 줄바꿈은 줄이 아니다)', () => {
  assert.equal(docEndLine('a\nb\n', 1), 2);
  assert.equal(docEndLine('a\nb', 5), 6);
  assert.equal(docEndLine('', 4), 3);
});
