// 경로 표시줄 조각의 이동 대상. 순수 함수다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { crumbTarget, folderOf, HOME_PATH, isFolderPath } from '../../src/app/route.ts';

test('루트 조각은 홈으로 간다', () => {
  assert.equal(crumbTarget(''), HOME_PATH);
  assert.equal(crumbTarget('/'), HOME_PATH);
});

test('폴더 조각은 그 폴더 주소(끝 /)로 간다', () => {
  assert.equal(crumbTarget('projects/devops'), 'projects/devops/');
  assert.equal(crumbTarget('projects/devops/'), 'projects/devops/');
});

test('폴더 주소 판정과 폴더 경로', () => {
  assert.equal(isFolderPath('projects/devops/'), true);
  assert.equal(isFolderPath('projects/devops/README.md'), false);
  assert.equal(folderOf('projects/devops/'), 'projects/devops');
  assert.equal(folderOf('projects/devops//'), 'projects/devops');
});
