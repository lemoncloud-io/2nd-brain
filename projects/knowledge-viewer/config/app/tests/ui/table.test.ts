// 표 보기의 순수 도우미 — 짧은 셀 판정, hast 텍스트 추출, 행 상세의 헤더·셀 짝짓기.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SHORT_CELL_MAX, hastText, isShortCell, pairRow } from '../../src/reader/table.ts';

test('isShortCell: 코드 포인트가 기준(12) 이하이면 짧은 셀이다', () => {
  assert.equal(SHORT_CELL_MAX, 12);
  assert.equal(isShortCell('active'), true);
  assert.equal(isShortCell('a'.repeat(12)), true);
  assert.equal(isShortCell('a'.repeat(13)), false);
  assert.equal(isShortCell(''), true);
});

test('isShortCell: 길이는 UTF-16 단위가 아니라 코드 포인트로 센다', () => {
  assert.equal(isShortCell('😀'.repeat(12)), true);
  assert.equal(isShortCell('😀'.repeat(13)), false);
  assert.equal(isShortCell('프로젝트별 실행 문서'), true);
});

test('isShortCell: 양끝 공백은 세지 않는다', () => {
  assert.equal(isShortCell(`  ${'a'.repeat(12)}  `), true);
});

test('hastText: 중첩 요소의 텍스트를 이어 붙인다', () => {
  const node = {
    type: 'element',
    tagName: 'td',
    children: [
      { type: 'text', value: '사진 ' },
      { type: 'element', tagName: 'code', children: [{ type: 'text', value: 'stereo' }] },
      { type: 'element', tagName: 'a', children: [{ type: 'text', value: ' 링크' }] },
    ],
  };
  assert.equal(hastText(node), '사진 stereo 링크');
  assert.equal(hastText(undefined), '');
});

test('pairRow: 헤더와 셀을 순서대로 짝짓고 헤더가 모자라면 null 이다', () => {
  assert.deepEqual(pairRow(['프로젝트', '상태'], ['a', 'b']), [
    { head: '프로젝트', cell: 'a' },
    { head: '상태', cell: 'b' },
  ]);
  assert.deepEqual(pairRow(['프로젝트'], ['a', 'b']), [
    { head: '프로젝트', cell: 'a' },
    { head: null, cell: 'b' },
  ]);
  assert.deepEqual(pairRow(['프로젝트', '상태', '목적'], ['a']), [{ head: '프로젝트', cell: 'a' }]);
});
