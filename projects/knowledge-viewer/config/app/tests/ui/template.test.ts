// 템플릿 — 자리표시자 제목은 파일 이름으로, templates/ 는 원문 보기.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isPlaceholderTitle, titleOf } from '../../shared/frontmatter.ts';
import { isTemplatePath } from '../../src/app/route.ts';

test('자리표시자 제목은 파일 이름으로 떨어진다', () => {
  assert.equal(isPlaceholderTitle('{{title}}'), true);
  assert.equal(isPlaceholderTitle('Weekly {{date}}'), true);
  assert.equal(isPlaceholderTitle('Wiki Index'), false);
  assert.equal(titleOf('templates/contact.md', {}, '# {{title}}\n'), 'contact');
  assert.equal(titleOf('templates/contact.md', { title: '{{title}}' }, ''), 'contact');
  assert.equal(titleOf('wiki/a.md', {}, '# 진짜 제목\n'), '진짜 제목');
});

test('templates/ 아래만 템플릿 경로다', () => {
  assert.equal(isTemplatePath('templates/contact.md'), true);
  assert.equal(isTemplatePath('templates/'), true);
  assert.equal(isTemplatePath('projects/x/templates/a.md'), false);
  assert.equal(isTemplatePath('wiki/templates.md'), false);
});
