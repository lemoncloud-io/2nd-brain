// WCAG 대비 계산(src/app/contrast.ts). 알려진 값으로 맞춘다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { contrastRatio, luminance, parseHex } from '../../src/app/contrast.ts';

test('hex 를 읽는다 — 3자리·6자리, 대소문자 무관, 다른 꼴은 null', () => {
  assert.deepEqual(parseHex('#fff'), [255, 255, 255]);
  assert.deepEqual(parseHex('#0F6B6B'), [15, 107, 107]);
  assert.equal(parseHex('rgb(0,0,0)'), null);
  assert.equal(parseHex('#12345'), null);
});

test('휘도: 검정 0, 흰색 1', () => {
  assert.equal(luminance('#000000'), 0);
  assert.equal(luminance('#ffffff'), 1);
  assert.throws(() => luminance('red'));
});

test('대비: 검정/흰색 21, 같은 색 1, 순서 무관, 알려진 경계값', () => {
  assert.equal(contrastRatio('#000', '#fff'), 21);
  assert.equal(contrastRatio('#777777', '#777777'), 1);
  assert.equal(contrastRatio('#fff', '#000'), contrastRatio('#000', '#fff'));
  // #777 on white 는 AA 에 아슬아슬하게 못 미치는 것으로 알려진 값(4.48).
  assert.equal(contrastRatio('#777777', '#ffffff').toFixed(2), '4.48');
  assert.equal(contrastRatio('#767676', '#ffffff').toFixed(2), '4.54');
});
