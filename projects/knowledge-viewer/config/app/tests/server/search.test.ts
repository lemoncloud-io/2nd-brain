import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { VaultIndex } from '../../server/index-store.ts';
import { searchIndex } from '../../server/search.ts';
import { makeFixtureVault } from '../helpers/fixture.ts';

describe('searchIndex', () => {
  let fx: ReturnType<typeof makeFixtureVault>;
  let idx: VaultIndex;
  beforeEach(() => {
    fx = makeFixtureVault();
    idx = new VaultIndex(fx.root);
    idx.build();
  });
  afterEach(() => fx.cleanup());

  const run = (q: string, includeOutside = false) => searchIndex(idx, q, { includeOutside, root: fx.root });

  it('alias·제목 일치가 맨 앞이다(한글)', () => {
    const hits = run('알파');
    assert.equal(hits[0]?.path, 'wiki/alpha.md');
    assert.ok((hits[0]?.score ?? 0) >= 180); // 제목 100 + alias 80
  });

  it('beta: wiki와 projects/demo 둘 다, raw는 없다', () => {
    const paths = run('beta').map((h) => h.path);
    assert.ok(paths.includes('wiki/beta.md'));
    assert.ok(paths.includes('projects/demo/beta.md'));
    assert.ok(!paths.includes('raw/beta.md'));
  });

  it('includeOutside면 raw/beta.md도 나온다', () => {
    const paths = run('beta', true).map((h) => h.path);
    assert.ok(paths.includes('raw/beta.md'));
    assert.ok(paths.includes('wiki/beta.md'));
  });

  it('private는 includeOutside여도 나오지 않는다', () => {
    assert.equal(run('비공개', true).length, 0);
  });

  it('대소문자를 무시하고 모든 단어가 있어야 한다', () => {
    assert.ok(run('ALPHA note').some((h) => h.path === 'wiki/alpha.md'));
    assert.equal(run('알파 zzzz없는단어').length, 0);
  });

  it('빈 질의는 빈 목록이다', () => {
    assert.deepEqual(run('   '), []);
  });

  it('본문 일치의 snippet은 일치 둘레의 본문이다', () => {
    const hit = run('docmap').find((h) => h.path === 'wiki/alpha.md');
    assert.ok(hit);
    assert.ok(hit.snippet.includes('docmap'));
    assert.ok(hit.snippet.length <= 125);
  });

  it('제목만 일치하면 snippet은 제목이다', () => {
    const hit = run('Alpha Note').find((h) => h.path === 'wiki/alpha.md');
    assert.ok(hit);
    assert.equal(hit.snippet, '알파');
  });

  it('점수 내림차순, 같으면 경로순이다', () => {
    const hits = run('beta', true);
    for (let i = 1; i < hits.length; i++) {
      const a = hits[i - 1]!;
      const b = hits[i]!;
      assert.ok(a.score > b.score || (a.score === b.score && a.path < b.path));
    }
  });

  it('정규식 메타문자도 글자 그대로 찾는다(예외 없음)', () => {
    assert.doesNotThrow(() => run('a.*('));
    assert.doesNotThrow(() => run('[', true));
  });

  it('raw의 심링크는 따라가지 않는다(볼트 밖·private)', () => {
    const outDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kv-out-'));
    try {
      const secret = path.join(outDir, 'secret.md');
      fs.writeFileSync(secret, '# s\n\nzzzsecret\n');
      fs.symlinkSync(secret, path.join(fx.root, 'raw', 'outside.md'));
      fs.symlinkSync('../private/p.md', path.join(fx.root, 'raw', 'priv.md'));
      assert.equal(run('zzzsecret', true).length, 0);
      assert.equal(run('비공개', true).length, 0);
      assert.ok(!run('원본', true).some((h) => h.path === 'raw/priv.md' || h.path === 'raw/outside.md'));
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
