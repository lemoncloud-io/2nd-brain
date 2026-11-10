// 앱 화면에서 나가는 이동: 앱 CSP 는 문서에 붙어 SPA 이동으로 벗겨지지 않는다 → 앱 문서에서 나가면 전체 페이지 이동(2026-11-05 실측).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { appHref, hrefFor } from '../../src/app/route.ts';
import { isAppHref, popAction, servedAsAppAt, shouldFullLoad } from '../../src/apps/leave.ts';
import { LOCAL } from '../../shared/source.ts';

test('servedAsAppAt: /apps 경로만 앱 문서다', () => {
  // 앱 경로
  assert.equal(servedAsAppAt('/apps/demo-desk'), true);
  assert.equal(servedAsAppAt('/apps/demo-board/x'), true);
  assert.equal(servedAsAppAt('/apps'), true);
  // 비앱 경로
  assert.equal(servedAsAppAt('/v/wiki/INDEX.md'), false);
  assert.equal(servedAsAppAt('/'), false);
  assert.equal(servedAsAppAt('/appsx'), false);
});

test('isAppHref: 질의·조각을 떼고 경로로 판정한다', () => {
  // 뷰어 문서 주소는 앱이 아니다(에이전트 질의·조각이 있어도).
  assert.equal(isAppHref(hrefFor('projects/x/public/index.html', 'a', true, LOCAL)), false);
  // 앱 주소(에이전트 모드 포함)
  assert.equal(isAppHref(appHref('demo-desk', true)), true);
  assert.equal(isAppHref('/apps/demo-desk#/list'), true);
});

test('shouldFullLoad: (a) 앱 → 비앱은 전체 이동', () => {
  assert.equal(shouldFullLoad({ servedAsApp: true, toApp: false }), true);
});

test('shouldFullLoad: (b) 앱 → 앱도 전체 이동(기존)', () => {
  assert.equal(shouldFullLoad({ servedAsApp: true, toApp: true }), true);
  // 비앱 → 앱도 전체 이동이다(토큰 meta 를 서버가 넣는다).
  assert.equal(shouldFullLoad({ servedAsApp: false, toApp: true }), true);
});

test('shouldFullLoad: (c) 비앱 → 비앱은 SPA', () => {
  assert.equal(shouldFullLoad({ servedAsApp: false, toApp: false }), false);
});

test('popAction: (d) 문서 종류와 새 주소가 다르면 다시 읽는다', () => {
  // 앱 문서에서 뒤로 가 뷰어 문서 주소가 되면 reload(주소는 이미 바뀌어 있다).
  assert.equal(popAction({ servedAsApp: true, nextIsApp: false }), 'reload');
  // 비앱 문서가 앱 주소를 만나면 reload(토큰 meta·헤더를 받는다).
  assert.equal(popAction({ servedAsApp: false, nextIsApp: true }), 'reload');
  // 같은 종류(앱 안 해시 이동, 문서 사이 이동)는 SPA 그대로.
  assert.equal(popAction({ servedAsApp: true, nextIsApp: true }), 'spa');
  assert.equal(popAction({ servedAsApp: false, nextIsApp: false }), 'spa');
});
