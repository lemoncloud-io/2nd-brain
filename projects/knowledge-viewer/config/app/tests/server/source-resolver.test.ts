import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { VaultIndex } from '../../server/index-store.ts';
import { SourceResolver } from '../../server/source-resolver.ts';
import { walkLint } from '../../shared/scope.ts';
import { makeFixtureVault } from '../helpers/fixture.ts';

type L = { kind: 'wiki' | 'md'; target: string };
const wiki = (target: string): L => ({ kind: 'wiki', target });
const md = (target: string): L => ({ kind: 'md', target });

describe('SourceResolver', () => {
  let fx: ReturnType<typeof makeFixtureVault>;
  let idx: VaultIndex;
  let res: SourceResolver;
  beforeEach(() => {
    fx = makeFixtureVault();
    idx = new VaultIndex(fx.root);
    idx.build();
    res = new SourceResolver(walkLint(fx.root), (n) => idx.aliasLookup(n));
  });
  afterEach(() => fx.cleanup());

  const A = 'wiki/alpha.md';
  const R = 'projects/demo/README.md';
  const cases: [string, L][] = [
    // wiki: 같은 폴더·다른 폴더·후보
    [A, wiki('beta')],
    [R, wiki('beta')],
    ['wiki/INDEX.md', wiki('beta')],
    [A, wiki('alpha')],
    [A, wiki('INDEX')],
    [R, wiki('INDEX')],
    // 대소문자·.md
    [A, wiki('Beta')],
    [A, wiki('BETA')],
    [A, wiki('beta.MD')],
    [A, wiki('beta.md')],
    [R, wiki('readme')],
    [A, wiki('README')],
    // 별칭
    [R, wiki('알파')],
    [A, wiki('알파')],
    [A, wiki('Alpha Note')],
    [A, wiki('alpha note')],
    [A, wiki('x/알파')],
    // 접미사
    [A, wiki('projects/demo/README')],
    [A, wiki('demo/README')],
    [A, wiki('Demo/readme.md')],
    [A, wiki('/demo/README/')],
    [A, wiki('wiki/beta')],
    [A, wiki('demo/beta')],
    [R, wiki('wiki/alpha')],
    // md 상대경로
    [R, md('../')],
    [R, md('../../wiki/beta.md')],
    [R, md('./beta.md')],
    [R, md('beta.md')],
    [R, md('./')],
    [R, md('.')],
    [A, md('../projects/demo/')],
    [A, md('../projects/demo')],
    [A, md('./')],
    [A, md('beta.md')],
    [A, md('./Beta.md')],
    [A, md('../../x.md')],
    ['alpha.md', md('../wiki/beta.md')],
    // 절대 대상
    [A, md('/beta.md')],
    [A, md('/wiki/beta.md')],
    // raw 제외
    [A, wiki('raw/beta')],
    [A, md('../raw/beta.md')],
    [A, wiki('raw/beta.md')],
    // 없는 대상
    [A, wiki('없음')],
    [A, md('missing.md')],
    [A, wiki('')],
    [A, wiki('a/b/c/d')],
  ];

  it('VaultIndex.resolve와 모든 경우에 같은 결과를 낸다', () => {
    assert.ok(cases.length >= 40);
    for (const [source, link] of cases) {
      assert.deepEqual(res.resolve(source, link), idx.resolve(source, link), `${source} ${link.kind}:${link.target}`);
    }
  });

  it('핵심 결과를 직접 확인한다', () => {
    assert.deepEqual(res.resolve(A, wiki('beta')), { path: 'wiki/beta.md', candidates: ['wiki/beta.md', 'projects/demo/beta.md'] });
    assert.deepEqual(res.resolve(R, wiki('beta')), { path: 'projects/demo/beta.md', candidates: ['projects/demo/beta.md', 'wiki/beta.md'] });
    assert.deepEqual(res.resolve(R, wiki('알파')), { path: 'wiki/alpha.md', candidates: [] });
    assert.equal(res.resolve(A, wiki('Beta')).path, 'wiki/beta.md');
    assert.equal(res.resolve(A, wiki('beta.MD')).path, 'wiki/beta.md');
    assert.equal(res.resolve(A, wiki('projects/demo/README')).path, R);
    assert.equal(res.resolve(A, wiki('demo/README')).path, R);
    assert.equal(res.resolve(R, md('../')).path, null);
    assert.equal(res.resolve(R, md('../../wiki/beta.md')).path, 'wiki/beta.md');
    assert.equal(res.resolve(A, md('/beta.md')).path, null);
    assert.equal(res.resolve(A, md('../projects/demo/')).path, R);
    assert.equal(res.resolve(A, md('../raw/beta.md')).path, null);
    assert.ok(!res.resolve(A, wiki('beta')).candidates.includes('raw/beta.md'));
    assert.deepEqual(res.resolve(A, wiki('없음')), { path: null, candidates: [] });
  });

  it('별칭 폴백이 없으면 별칭은 풀리지 않는다', () => {
    const plain = new SourceResolver(walkLint(fx.root));
    assert.deepEqual(plain.resolve(R, wiki('알파')), { path: null, candidates: [] });
    assert.equal(plain.resolve(R, wiki('beta')).path, 'projects/demo/beta.md');
  });

  it('파일 하나짜리 집합에서는 그 파일만 풀린다', () => {
    const one = new SourceResolver(['wiki/new.md']);
    assert.deepEqual(one.resolve(A, wiki('new')), { path: 'wiki/new.md', candidates: [] });
    assert.deepEqual(one.resolve(A, wiki('beta')), { path: null, candidates: [] });
    assert.equal(one.resolve(A, md('new.md')).path, 'wiki/new.md');
  });
});
