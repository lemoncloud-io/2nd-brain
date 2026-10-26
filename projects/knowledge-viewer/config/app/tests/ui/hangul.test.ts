// 한글 초성 분해·글자 비교. 순수 함수다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { charMatches, choseongOf, foldChars, isConsonantJamo } from '../../src/app/hangul.ts';

test('choseongOf: 음절의 초성, 음절이 아니면 null', () => {
  assert.equal(choseongOf('지'), 'ㅈ');
  assert.equal(choseongOf('식'), 'ㅅ');
  assert.equal(choseongOf('까'), 'ㄲ');
  assert.equal(choseongOf('힣'), 'ㅎ');
  assert.equal(choseongOf('a'), null);
  assert.equal(choseongOf('ㅈ'), null);
  assert.equal(choseongOf('1'), null);
});

test('isConsonantJamo: 호환 자음만 참', () => {
  assert.equal(isConsonantJamo('ㅈ'), true);
  assert.equal(isConsonantJamo('ㄲ'), true);
  assert.equal(isConsonantJamo('ㅏ'), false);
  assert.equal(isConsonantJamo('지'), false);
  assert.equal(isConsonantJamo('a'), false);
});

test('foldChars: NFC 로 모으고 라틴은 소문자, 한글·숫자는 그대로', () => {
  assert.deepEqual(foldChars('Agent Memory'), [...'agent memory']);
  assert.deepEqual(foldChars('INDEX'), [...'index']);
  // 자소 분리된(NFD) 입력도 음절로 모은다.
  assert.deepEqual(foldChars('지식'.normalize('NFD')), ['지', '식']);
  assert.deepEqual(foldChars('ㅈㅅ1'), ['ㅈ', 'ㅅ', '1']);
});

test('charMatches: 같은 글자는 exact, 자음은 음절의 초성과 initial', () => {
  assert.equal(charMatches('지', '지'), 'exact');
  assert.equal(charMatches('a', 'a'), 'exact');
  assert.equal(charMatches('ㅈ', 'ㅈ'), 'exact');
  assert.equal(charMatches('ㅈ', '지'), 'initial');
  assert.equal(charMatches('ㅅ', '식'), 'initial');
  assert.equal(charMatches('ㅈ', '식'), null);
  assert.equal(charMatches('지', '식'), null);
  assert.equal(charMatches('a', 'b'), null);
  // 자음은 음절에만 초성으로 맞는다. 라틴·숫자에는 안 맞는다.
  assert.equal(charMatches('ㅈ', 'j'), null);
});

test('charMatches: 평자음은 된소리 초성에도 맞고, 된소리는 평자음에 안 맞는다', () => {
  assert.equal(charMatches('ㄱ', '까'), 'initial');
  assert.equal(charMatches('ㄲ', '까'), 'initial');
  assert.equal(charMatches('ㄲ', '가'), null);
  assert.equal(charMatches('ㅅ', '쓰'), 'initial');
});
