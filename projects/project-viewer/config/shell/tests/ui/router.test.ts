import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseHash, formatRoute } from '../../src/app/router.ts';
import type { Route } from '../../src/app/router.ts';

// 왕복이 깨지면 링크를 눌러 이동한 뒤 주소를 복사했을 때 다른 화면이 열린다.
const roundTrip: Route[] = [
  { kind: 'home' },
  { kind: 'page', pageId: 'overview' },
  { kind: 'page', pageId: 'overview', itemId: 'N1' },
  { kind: 'glossary' },
  { kind: 'glossary', termId: 'g.source' },
  { kind: 'docs' },
  { kind: 'docs', sourceId: 'spec' },
  { kind: 'docs', sourceId: 'spec', slug: 'check-rules' },
  { kind: 'search', q: 'graph' },
];

test('모든 경로 형태가 format → parse 왕복에서 같은 값으로 돌아온다', () => {
  for (const route of roundTrip) {
    const hash = formatRoute(route);
    assert.equal(hash.startsWith('#/'), true, `해시는 #/로 시작해야 한다: ${hash}`);
    assert.deepEqual(parseHash(hash), route, `왕복 실패: ${hash}`);
  }
});

test('한글·공백이 든 slug와 질의는 인코딩되고 그대로 되돌아온다', () => {
  const route: Route = { kind: 'docs', sourceId: 'spec', slug: '검사-규칙 절' };
  const hash = formatRoute(route);
  assert.equal(hash.includes(' '), false, '공백이 인코딩되지 않았다');
  assert.equal(/[가-힣]/.test(hash), false, '한글이 인코딩되지 않았다');
  assert.deepEqual(parseHash(hash), route);

  const q: Route = { kind: 'search', q: '단계 상태' };
  const qhash = formatRoute(q);
  assert.equal(qhash.includes(' '), false);
  assert.deepEqual(parseHash(qhash), q);
});

test('브라우저가 이미 인코딩해 둔 해시도 같은 값으로 읽는다', () => {
  assert.deepEqual(parseHash('#/docs/spec/%EA%B2%80%EC%82%AC'), {
    kind: 'docs',
    sourceId: 'spec',
    slug: '검사',
  });
});

test('모르는 경로·빈 해시는 첫 페이지로 떨어진다', () => {
  for (const hash of ['', '#', '#/', '/', '#/nope', '#/p', '#//', '#/p//x', 'garbage']) {
    assert.deepEqual(parseHash(hash), { kind: 'home' }, `첫 페이지가 아니다: ${JSON.stringify(hash)}`);
  }
});

test('search는 빈 질의를 첫 페이지로 떨어뜨린다', () => {
  assert.deepEqual(parseHash('#/search/'), { kind: 'home' });
  assert.deepEqual(parseHash('#/search'), { kind: 'home' });
});

test('경로 끝의 여분 segment는 무시하지 않고 첫 페이지로 떨어진다', () => {
  assert.deepEqual(parseHash('#/p/a/b/c'), { kind: 'home' });
  assert.deepEqual(parseHash('#/glossary/a/b'), { kind: 'home' });
  assert.deepEqual(parseHash('#/docs/a/b/c'), { kind: 'home' });
});
