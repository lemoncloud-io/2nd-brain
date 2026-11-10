import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractHeadings, slugify } from '../../model/slug.ts';

test('한글 헤딩은 음절을 지키고 공백만 하이픈이 된다', () => {
  assert.equal(slugify('진실원 규칙', new Map()), '진실원-규칙');
  assert.equal(slugify('상태 원장', new Map()), '상태-원장');
});

test('문장부호는 제거된다', () => {
  assert.equal(slugify('Hello, World!', new Map()), 'hello-world');
  assert.equal(slugify('A/B 테스트', new Map()), 'ab-테스트');
});

test('같은 헤딩이 거듭 나오면 -1, -2가 붙는다', () => {
  const seen = new Map<string, number>();
  assert.equal(slugify('같은 헤딩', seen), '같은-헤딩');
  assert.equal(slugify('같은 헤딩', seen), '같은-헤딩-1');
  assert.equal(slugify('같은 헤딩', seen), '같은-헤딩-2');
});

test('코드펜스 안의 #은 헤딩이 아니다', () => {
  const md = ['# 진짜 헤딩', '', '```sh', '# 가짜 헤딩', '```', '', '## 두 번째', ''].join('\n');
  const headings = extractHeadings(md);
  assert.deepEqual(
    headings.map((h) => h.text),
    ['진짜 헤딩', '두 번째'],
  );
  assert.deepEqual(
    headings.map((h) => h.line),
    [1, 7],
  );
});

test('인라인 코드와 링크가 든 헤딩은 평문으로 슬러그를 만든다', () => {
  const md = '## `code` and [link](https://example.invalid)\n';
  const headings = extractHeadings(md);
  assert.equal(headings.length, 1);
  assert.equal(headings[0]!.text, 'code and link');
  assert.equal(headings[0]!.slug, 'code-and-link');
  assert.equal(headings[0]!.depth, 2);
});

test('본문 안에서 중복된 헤딩은 extractHeadings에서도 -1을 받는다', () => {
  const md = ['# 규칙', '', '내용', '', '# 규칙', ''].join('\n');
  assert.deepEqual(
    extractHeadings(md).map((h) => h.slug),
    ['규칙', '규칙-1'],
  );
});

test('줄 번호는 받은 문자열 기준이다 — frontmatter 보정은 호출자 몫이다', () => {
  const body = '\n\n# 나중 헤딩\n';
  assert.equal(extractHeadings(body)[0]!.line, 3);
});

test('setext 헤딩도 잡는다', () => {
  const md = ['개요', '====', '', '본문', ''].join('\n');
  const headings = extractHeadings(md);
  assert.equal(headings.length, 1);
  assert.equal(headings[0]!.depth, 1);
  assert.equal(headings[0]!.text, '개요');
});
