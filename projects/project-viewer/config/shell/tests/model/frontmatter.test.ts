import { test } from 'node:test';
import assert from 'node:assert/strict';

import { splitFrontmatter } from '../../model/frontmatter.ts';

test('frontmatter를 떼고 본문은 바이트 그대로 남긴다', () => {
  const body = '# 제목\n\n본문   \n\t탭으로 시작하는 줄\n\n';
  const text = `---\ntitle: 제목\nstatus: draft\n---\n${body}`;
  const out = splitFrontmatter(text);
  assert.deepEqual(out.data, { title: '제목', status: 'draft' });
  assert.equal(out.body, body);
  assert.equal(out.bodyStartLine, 5);
});

test('frontmatter가 없으면 본문이 그대로고 시작 줄은 1이다', () => {
  const text = '# 제목\n본문\n';
  const out = splitFrontmatter(text);
  assert.deepEqual(out.data, {});
  assert.equal(out.body, text);
  assert.equal(out.bodyStartLine, 1);
});

test('닫히지 않은 구분선은 frontmatter가 아니다', () => {
  const text = '---\ntitle: 제목\n\n# 본문\n';
  const out = splitFrontmatter(text);
  assert.deepEqual(out.data, {});
  assert.equal(out.body, text);
  assert.equal(out.bodyStartLine, 1);
});

test('본문 안의 --- 구분선은 frontmatter를 다시 열지 않는다', () => {
  const text = '---\ntitle: 제목\n---\n\n앞\n\n---\n\n뒤\n';
  const out = splitFrontmatter(text);
  assert.deepEqual(out.data, { title: '제목' });
  assert.equal(out.body, '\n앞\n\n---\n\n뒤\n');
  assert.equal(out.bodyStartLine, 4);
});
