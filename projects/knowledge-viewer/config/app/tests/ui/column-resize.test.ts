// 열 폭 드래그의 방향: 왼쪽 열은 오른쪽으로 끌면, 오른쪽 열은 왼쪽으로 끌면 넓어진다. 범위로 자른다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dragWidth } from '../../src/app/useColumnResize.ts';
import { LEFT_MAX, LEFT_MIN, RIGHT_MAX, RIGHT_MIN } from '../../src/app/prefs/layout.ts';

test('왼쪽 열: 오른쪽으로 끌면 넓어지고 왼쪽으로 끌면 좁아진다', () => {
  assert.equal(dragWidth('left', 280, 40), 320);
  assert.equal(dragWidth('left', 280, -40), 240);
});

test('오른쪽 열: 왼쪽으로 끌면(dx 음수) 넓어지고 오른쪽으로 끌면 좁아진다', () => {
  assert.equal(dragWidth('right', 320, -80), 400);
  assert.equal(dragWidth('right', 320, 40), 280);
});

test('끝까지 끌면 각 열의 최소·최대 폭에서 멈춘다', () => {
  assert.equal(dragWidth('left', 280, 5000), LEFT_MAX);
  assert.equal(dragWidth('left', 280, -5000), LEFT_MIN);
  assert.equal(dragWidth('right', 320, -5000), RIGHT_MAX);
  assert.equal(dragWidth('right', 320, 5000), RIGHT_MIN);
});
