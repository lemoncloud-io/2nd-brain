import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAIN } from '../../shared/source.ts';
import { hrefFor, parseLocation, searchTarget } from '../../src/app/route.ts';

/** 지도 인자의 기본값. 문서 보기에도 늘 붙는다. */
const G0 = { depth: 2, mode: '3d', all: false } as const;

test('parseLocation: /v/ 경로를 풀고 agent·anchor를 읽는다', () => {
  assert.deepEqual(
    parseLocation('/v/raw/%ED%95%9C%EA%B8%80%20%ED%8C%8C%EC%9D%BC.md', '?agent=claude', '#둘째'),
    { path: 'raw/한글 파일.md', anchor: '둘째', agent: true, src: MAIN, view: 'doc', graph: G0 },
  );
});

test('parseLocation: / 와 /v/ 는 wiki/INDEX.md', () => {
  assert.deepEqual(parseLocation('/', '', ''), { path: 'wiki/INDEX.md', anchor: '', agent: false, src: MAIN, view: 'doc', graph: G0 });
  assert.deepEqual(parseLocation('/v/', '', ''), { path: 'wiki/INDEX.md', anchor: '', agent: false, src: MAIN, view: 'doc', graph: G0 });
});

test('parseLocation: agent 값이 claude가 아니면 false', () => {
  assert.equal(parseLocation('/v/a.md', '?agent=other', '').agent, false);
});

test('hrefFor: 한글 경로 인코딩, agent, anchor', () => {
  assert.equal(
    hrefFor('raw/한글 파일.md', '둘째', true),
    '/v/raw/%ED%95%9C%EA%B8%80%20%ED%8C%8C%EC%9D%BC.md?agent=claude#둘째',
  );
  assert.equal(hrefFor('wiki/INDEX.md'), '/v/wiki/INDEX.md');
});

test('hrefFor: 경로 안의 ?·# 는 부호화하고 parseLocation 으로 되돌아온다', () => {
  const href = hrefFor('a/b?c#d.md', 'x');
  assert.equal(href, '/v/a/b%3Fc%23d.md#x');
  const u = new URL(href, 'http://127.0.0.1');
  assert.equal(parseLocation(u.pathname, u.search, u.hash).path, 'a/b?c#d.md');
});

test('parseLocation: view=graph 만 지도 모드, 그 밖은 doc', () => {
  assert.equal(parseLocation('/v/a.md', '?view=graph', '').view, 'graph');
  assert.equal(parseLocation('/v/a.md', '?view=x', '').view, 'doc');
  assert.equal(parseLocation('/v/a.md', '', '').view, 'doc');
  const r = parseLocation('/v/a.md', '?agent=claude&view=graph', '');
  assert.equal(r.agent, true);
  assert.equal(r.view, 'graph');
});

test('hrefFor: view=graph 질의를 붙인다(agent 와 함께면 agent 먼저)', () => {
  assert.equal(hrefFor('wiki/INDEX.md', undefined, false, undefined, 'graph'), '/v/wiki/INDEX.md?view=graph');
  assert.equal(hrefFor('a.md', '절', true, undefined, 'graph'), '/v/a.md?agent=claude&view=graph#절');
  assert.equal(hrefFor('a.md', undefined, true, undefined, 'doc'), '/v/a.md?agent=claude');
  assert.equal(hrefFor('a.md'), '/v/a.md');
});

test('hrefFor → parseLocation: view 가 되돌아온다', () => {
  const u = new URL(hrefFor('wiki/INDEX.md', 'x', true, undefined, 'graph'), 'http://127.0.0.1');
  assert.deepEqual(parseLocation(u.pathname, u.search, u.hash), { path: 'wiki/INDEX.md', anchor: 'x', agent: true, src: MAIN, view: 'graph', graph: G0 });
});

test('parseLocation: 지도 인자 depth·mode·all 을 읽는다', () => {
  assert.deepEqual(parseLocation('/v/a.md', '?view=graph&depth=3&mode=2d&all=1', '').graph, { depth: 3, mode: '2d', all: true });
  assert.deepEqual(parseLocation('/v/a.md', '?view=graph&depth=1', '').graph, { depth: 1, mode: '3d', all: false });
});

test('parseLocation: 범위 밖 depth 는 2, 모르는 mode 는 3d, all 은 1 만 참', () => {
  assert.equal(parseLocation('/v/a.md', '?view=graph&depth=9', '').graph.depth, 2);
  assert.equal(parseLocation('/v/a.md', '?view=graph&depth=0', '').graph.depth, 2);
  assert.equal(parseLocation('/v/a.md', '?view=graph&depth=2.5', '').graph.depth, 2);
  assert.equal(parseLocation('/v/a.md', '?view=graph&mode=x', '').graph.mode, '3d');
  assert.equal(parseLocation('/v/a.md', '?view=graph&all=true', '').graph.all, false);
  assert.deepEqual(parseLocation('/v/a.md', '', '').graph, G0);
});

test('hrefFor: 지도 인자는 기본값이 아닐 때만 쓴다(agent·src·view·depth·mode·all 순)', () => {
  assert.equal(hrefFor('a.md', undefined, false, undefined, { view: 'graph', depth: 1, mode: '2d' }), '/v/a.md?view=graph&depth=1&mode=2d');
  assert.equal(hrefFor('a.md', undefined, false, undefined, { view: 'graph', depth: 2, mode: '3d' }), '/v/a.md?view=graph');
  assert.equal(hrefFor('a.md', undefined, false, undefined, { view: 'graph' }), '/v/a.md?view=graph');
  assert.equal(
    hrefFor('a.md', '절', true, undefined, { view: 'graph', depth: 3, mode: '2d', all: true }),
    '/v/a.md?agent=claude&view=graph&depth=3&mode=2d&all=1#절',
  );
  assert.equal(hrefFor('a.md', undefined, false, undefined, { view: 'graph', all: false }), '/v/a.md?view=graph');
});

test('hrefFor → parseLocation: 지도 인자가 되돌아온다', () => {
  const u = new URL(hrefFor('wiki/INDEX.md', undefined, true, undefined, { view: 'graph', depth: 3, mode: '2d', all: true }), 'http://127.0.0.1');
  assert.deepEqual(parseLocation(u.pathname, u.search, u.hash), {
    path: 'wiki/INDEX.md',
    anchor: '',
    agent: true,
    src: MAIN,
    view: 'graph',
    graph: { depth: 3, mode: '2d', all: true },
  });
});

test('searchTarget: 지도에서 고르면 그 문서 중심의 지도(깊이·모드 유지, 전체 보기는 걷는다)', () => {
  assert.deepEqual(searchTarget({ view: 'graph', graph: { depth: 3, mode: '2d', all: false } }, 'wiki/beta.md'), {
    view: 'graph',
    depth: 3,
    mode: '2d',
  });
  const all = searchTarget({ view: 'graph', graph: { depth: 1, mode: '3d', all: true } }, 'wiki/beta.md');
  assert.deepEqual(all, { view: 'graph', depth: 1, mode: '3d' });
  assert.equal(hrefFor('wiki/beta.md', undefined, false, undefined, all).includes('all='), false);
});

test('searchTarget: 문서 보기·md 가 아닌 문서는 리더(undefined)', () => {
  assert.equal(searchTarget({ view: 'doc', graph: G0 }, 'wiki/beta.md'), undefined);
  assert.equal(searchTarget({ view: 'graph', graph: G0 }, 'outputs/x.html'), undefined);
});

test('hrefFor: src 와 view 를 함께 주면 src 가 view 앞이다(main 은 src 를 쓰지 않는다)', () => {
  const pr = { kind: 'pr', number: 12 } as const;
  assert.equal(hrefFor('a.md', undefined, false, pr, 'graph'), '/v/a.md?src=pr:12&view=graph');
  assert.equal(hrefFor('a.md', undefined, true, pr, { view: 'graph', depth: 1 }), '/v/a.md?agent=claude&src=pr:12&view=graph&depth=1');
  assert.equal(hrefFor('a.md', undefined, false, MAIN, 'graph'), '/v/a.md?view=graph');
  // 소스를 바꿔도 지도 보기를 유지할 때(App 의 setSource)의 주소: 기본 지도 인자는 쓰지 않는다.
  assert.equal(hrefFor('a.md', undefined, false, pr, { view: 'graph', depth: 2, mode: '3d' }), '/v/a.md?src=pr:12&view=graph');
});

test('hrefFor → parseLocation: src 와 view 가 함께 되돌아온다', () => {
  const u = new URL(hrefFor('a.md', undefined, false, { kind: 'pr', number: 12 }, 'graph'), 'http://127.0.0.1');
  const r = parseLocation(u.pathname, u.search, u.hash);
  assert.deepEqual(r.src, { kind: 'pr', number: 12 });
  assert.equal(r.view, 'graph');
  assert.deepEqual(r.graph, G0);
});
