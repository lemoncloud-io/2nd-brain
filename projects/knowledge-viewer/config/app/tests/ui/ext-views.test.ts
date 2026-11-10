// 가운데 열 확장 화면(?view=<id>) 라우팅: 딥링크(소스·에이전트·안쪽 질의 유지), 옛 경로, 실제 해시 유지, 모르는 보기.
// 합성 보기(FAKE_VIEW)로 본다 — 이 볼트의 실제 화면은 확장 쪽 시험이 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hrefFor, parseLocation } from '../../src/app/route.ts';
import { findView, isHashRouted, viewAnchor } from '../../src/app/ext-views.ts';
import { FAKE_VIEW } from '../helpers/fake-ext.ts';

const VIEWS = [FAKE_VIEW];

test('확장 화면 딥링크는 소스·에이전트·안쪽 질의를 지키고, 옛 경로는 그 화면으로 연다', () => {
  for (const src of [{ kind: 'local' }, { kind: 'main' }, { kind: 'pr', number: 123 }] as const) {
    const href = hrefFor(FAKE_VIEW.home.path, '/features?q=로그인&page=2', true, src, FAKE_VIEW.id);
    const url = new URL(href, 'http://localhost');
    const route = parseLocation(url.pathname, url.search, url.hash, VIEWS);
    assert.equal(route.view, 'atlas');
    assert.equal(route.path, FAKE_VIEW.home.path);
    assert.deepEqual(route.src, src);
    assert.equal(route.agent, true);
    assert.equal(route.anchor, '/features?q=로그인&page=2');
    const old = parseLocation(`/v/${FAKE_VIEW.legacyPaths![0]}`, url.search.replace('&view=atlas', ''), '#/flows/auth', VIEWS);
    assert.equal(old.path, FAKE_VIEW.home.path);
    assert.equal(old.view, 'atlas');
    assert.equal(old.anchor, '/flows/auth');
    assert.deepEqual(old.src, src);
  }
  assert.equal(parseLocation('/v/wiki/INDEX.md', '', '', VIEWS).view, 'doc');
});

test('소스 전환 때는 실제 해시를 예약문자 인코딩 그대로 옮기고, 안쪽 주소가 아니면 첫 화면이다', () => {
  const latest = '#/features?q=a%26b%3Dc%23d&page=2';
  const changed = hrefFor(FAKE_VIEW.home.path, viewAnchor(FAKE_VIEW, latest), false, { kind: 'main' }, FAKE_VIEW.id);
  assert.equal(new URL(changed, 'http://localhost').hash, latest);
  assert.equal(viewAnchor(FAKE_VIEW, '#section'), '/map');
  // 안쪽 라우터가 없는 보기는 늘 첫 화면 앵커다.
  assert.equal(viewAnchor({ ...FAKE_VIEW, hashRouted: false }, '#/x'), '/map');
  assert.equal(viewAnchor({ ...FAKE_VIEW, hashRouted: false, home: { path: 'a.md' } }, '#/x'), '');
});

test('등록되지 않은 보기·확장이 없을 때: ?view=<id> 와 옛 경로는 일반 문서로 연다', () => {
  // 확장이 없으면(기본 등록부, 유닛 시험은 빈 확장).
  const unknown = parseLocation(`/v/${FAKE_VIEW.home.path}`, '?view=atlas', '#/map');
  assert.equal(unknown.view, 'doc');
  assert.equal(unknown.path, FAKE_VIEW.home.path);
  assert.equal(unknown.anchor, '/map');
  const legacy = parseLocation(`/v/${FAKE_VIEW.legacyPaths![0]}`, '', '#/flows/auth');
  assert.equal(legacy.view, 'doc');
  assert.equal(legacy.path, FAKE_VIEW.legacyPaths![0]);
  // 등록돼도 모르는 view 값은 리더, graph 는 지도.
  assert.equal(parseLocation('/v/wiki/a.md', '?view=nope', '', VIEWS).view, 'doc');
  assert.equal(parseLocation('/v/wiki/a.md', '?view=graph', '', VIEWS).view, 'graph');
});

test('헬퍼: 등록된 보기 찾기·안쪽 라우터 판정, 주소의 view 질의', () => {
  assert.equal(findView(VIEWS, 'atlas'), FAKE_VIEW);
  assert.equal(findView(VIEWS, 'doc'), null);
  assert.equal(findView(VIEWS, undefined), null);
  assert.equal(isHashRouted(VIEWS, 'atlas'), true);
  assert.equal(isHashRouted(VIEWS, 'graph'), false);
  assert.equal(hrefFor('a.md', undefined, false, { kind: 'main' }, 'doc'), '/v/a.md');
  assert.equal(hrefFor('a.md', 'x', false, { kind: 'local' }, 'atlas'), '/v/a.md?src=local&view=atlas#x');
});
