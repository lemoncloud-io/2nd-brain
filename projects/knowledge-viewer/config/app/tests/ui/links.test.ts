import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isPlainClick } from '../../src/app/links.ts';

const plain = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, button: 0 };

test('isPlainClick: 수정키 없는 왼쪽 클릭은 true', () => {
  assert.equal(isPlainClick(plain), true);
});

test('isPlainClick: 수정키 하나라도 있으면 false', () => {
  for (const k of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
    assert.equal(isPlainClick({ ...plain, [k]: true }), false, k);
  }
});

test('isPlainClick: 가운데·오른쪽 단추는 false', () => {
  assert.equal(isPlainClick({ ...plain, button: 1 }), false);
  assert.equal(isPlainClick({ ...plain, button: 2 }), false);
});
