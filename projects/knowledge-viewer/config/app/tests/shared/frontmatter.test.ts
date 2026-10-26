import { test } from 'node:test';
import assert from 'node:assert/strict';

import { aliasesOf, splitFrontmatter, titleOf } from '../../shared/frontmatter.ts';

test('aliases 배열은 다듬고 빈 값을 뺀다', () => {
  assert.deepEqual(aliasesOf({ aliases: ['a', ' b ', ''] }), ['a', 'b']);
});

test('aliases 문자열 하나도 목록이 된다', () => {
  assert.deepEqual(aliasesOf({ aliases: 'solo' }), ['solo']);
});

test('aliases가 없으면 빈 목록이다', () => {
  assert.deepEqual(aliasesOf({}), []);
});

test('frontmatter title이 H1보다 우선한다', () => {
  assert.equal(titleOf('wiki/x.md', { title: 'T' }, '# H'), 'T');
});

test('frontmatter title이 비어 있으면 H1을 쓴다', () => {
  assert.equal(titleOf('wiki/x.md', { title: '  ' }, '# H1\n'), 'H1');
});

test('H1을 쓴다', () => {
  assert.equal(titleOf('wiki/x.md', {}, '# H1\n'), 'H1');
});

test('펜스 안의 # 줄은 제목이 아니다', () => {
  const body = '```md\n# 코드 안\n```\n\n## 소제목\n\n# 진짜 제목\n';
  assert.equal(titleOf('wiki/x.md', {}, body), '진짜 제목');
});

test('~~~ 펜스 안의 # 줄도 제목이 아니다', () => {
  const body = '~~~\n# 코드 안\n~~~\n# 밖\n';
  assert.equal(titleOf('wiki/x.md', {}, body), '밖');
});

test('# 뒤가 줄바꿈이면 제목이 아니다(다음 줄을 제목으로 쓰지 않는다)', () => {
  assert.equal(titleOf('wiki/x.md', {}, '#\nfoo\n'), 'x');
});

test('H1이 없으면 파일 이름(확장자 제외)을 쓴다', () => {
  assert.equal(titleOf('wiki/x.md', {}, '본문만'), 'x');
});

test('깨진 YAML은 data를 비우고 본문은 살린다', () => {
  const r = splitFrontmatter('---\nkey: [unclosed\n---\n# H\n');
  assert.deepEqual(r.data, {});
  assert.equal(r.body, '# H\n');
});

test('frontmatter를 떼고 본문 시작 줄을 센다', () => {
  const r = splitFrontmatter('---\ntitle: T\n---\n# H\n');
  assert.deepEqual(r.data, { title: 'T' });
  assert.equal(r.body, '# H\n');
  assert.equal(r.bodyStartLine, 4);
});
