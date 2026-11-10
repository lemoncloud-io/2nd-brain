import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseInline } from '../../src/app/parseInline.ts';

test('평문은 텍스트 토큰 하나다', () => {
  assert.deepEqual(parseInline('단계 상태를 원장에서 읽는다'), [
    { type: 'text', text: '단계 상태를 원장에서 읽는다' },
  ]);
});

test('빈 문자열은 토큰이 없다', () => {
  assert.deepEqual(parseInline(''), []);
});

test('백틱은 코드 토큰, 별표 둘은 굵게 토큰이 된다', () => {
  assert.deepEqual(parseInline('`viewer.yml` 하나로 **단일 HTML**을 만든다'), [
    { type: 'code', text: 'viewer.yml' },
    { type: 'text', text: ' 하나로 ' },
    { type: 'strong', text: '단일 HTML' },
    { type: 'text', text: '을 만든다' },
  ]);
});

test('코드 안의 별표는 굵게로 해석하지 않는다', () => {
  assert.deepEqual(parseInline('`**a**`'), [{ type: 'code', text: '**a**' }]);
});

test('짝이 맞지 않는 백틱·별표는 그냥 글자로 남는다', () => {
  assert.deepEqual(parseInline('a ` b'), [{ type: 'text', text: 'a ` b' }]);
  assert.deepEqual(parseInline('2 ** 3'), [{ type: 'text', text: '2 ** 3' }]);
  assert.deepEqual(parseInline('**열린 채'), [{ type: 'text', text: '**열린 채' }]);
});

test('빈 코드·빈 굵게는 토큰을 만들지 않는다', () => {
  assert.deepEqual(parseInline('a `` b'), [{ type: 'text', text: 'a `` b' }]);
  assert.deepEqual(parseInline('a **** b'), [{ type: 'text', text: 'a **** b' }]);
});

test('링크 문법은 해석하지 않는다 — 원본으로 가는 길은 근거 참조뿐이다', () => {
  assert.deepEqual(parseInline('[설계](docs/design.md)를 본다'), [
    { type: 'text', text: '[설계](docs/design.md)를 본다' },
  ]);
});

test('HTML은 절대 해석하지 않고 글자 그대로 남긴다', () => {
  const tokens = parseInline('<img src=x onerror=alert(1)> <b>굵게</b>');
  assert.deepEqual(tokens, [{ type: 'text', text: '<img src=x onerror=alert(1)> <b>굵게</b>' }]);
  assert.equal(tokens.every((t) => t.type === 'text'), true);
});

test('별표 하나(기울임)는 해석하지 않는다', () => {
  assert.deepEqual(parseInline('*강조 아님*'), [{ type: 'text', text: '*강조 아님*' }]);
});

test('여러 조각이 섞여도 순서와 글자가 보존된다', () => {
  const src = '앞 `코드` 사이 **굵게** 뒤 `또` 끝';
  const tokens = parseInline(src);
  assert.deepEqual(tokens.map((t) => t.type), ['text', 'code', 'text', 'strong', 'text', 'code', 'text']);
  assert.equal(
    tokens
      .map((t) => (t.type === 'code' ? `\`${t.text}\`` : t.type === 'strong' ? `**${t.text}**` : t.text))
      .join(''),
    src,
    '토큰을 되붙이면 원문이 되어야 한다',
  );
});
