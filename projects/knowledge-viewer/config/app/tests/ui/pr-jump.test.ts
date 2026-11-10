// 검색 상자에 PR 번호(`123`·`#123`·`pr 123`)를 치면 그 PR 로 바로 가는 판정. 순수.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parsePrJump } = await import('../../src/app/pr-jump.ts');

test('parsePrJump: 숫자·#숫자·pr 숫자(대소문자·공백 무시)는 번호, 그 밖은 null', () => {
  assert.equal(parsePrJump('123'), 123);
  assert.equal(parsePrJump('#123'), 123);
  assert.equal(parsePrJump('pr 123'), 123);
  assert.equal(parsePrJump('PR#123'), 123);
  assert.equal(parsePrJump(' 123 '), 123);
  assert.equal(parsePrJump('0'), null);
  assert.equal(parsePrJump('123a'), null);
  assert.equal(parsePrJump('2026-10-27'), null);
  assert.equal(parsePrJump(''), null);
  assert.equal(parsePrJump('12345678'), null);
});
