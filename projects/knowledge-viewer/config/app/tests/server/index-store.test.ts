import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { VaultIndex } from '../../server/index-store.ts';
import { makeFixtureVault } from '../helpers/fixture.ts';

describe('VaultIndex', () => {
  let fx: ReturnType<typeof makeFixtureVault>;
  let idx: VaultIndex;
  beforeEach(() => {
    fx = makeFixtureVault();
    idx = new VaultIndex(fx.root);
    idx.build();
  });
  afterEach(() => fx.cleanup());

  it('files는 lint 범위 문서만 담는다', () => {
    assert.ok(idx.files.has('wiki/alpha.md'));
    assert.ok(!idx.files.has('raw/beta.md'));
    assert.ok(!idx.files.has('private/p.md'));
    assert.ok(!idx.files.has('outputs/local.md'));
  });

  it('title·aliases·body', () => {
    assert.equal(idx.title('wiki/alpha.md'), '알파');
    assert.deepEqual(idx.aliases('wiki/alpha.md'), ['알파', 'Alpha Note']);
    assert.ok(idx.body('wiki/alpha.md').startsWith('\n# 알파'));
    assert.ok(!idx.body('wiki/alpha.md').includes('type: concept'));
    assert.throws(() => idx.body('raw/beta.md'));
  });

  it('wiki: 같은 폴더가 먼저고 충돌은 candidates에 남는다', () => {
    const r = idx.resolve('wiki/alpha.md', { kind: 'wiki', target: 'beta' });
    assert.equal(r.path, 'wiki/beta.md');
    assert.deepEqual(r.candidates, ['wiki/beta.md', 'projects/demo/beta.md']);
  });

  it('wiki: 다른 폴더의 같은 이름', () => {
    const r = idx.resolve('projects/demo/README.md', { kind: 'wiki', target: 'beta' });
    assert.equal(r.path, 'projects/demo/beta.md');
    assert.deepEqual(r.candidates, ['projects/demo/beta.md', 'wiki/beta.md']);
  });

  it('wiki: 대소문자·.md 접미를 무시한다', () => {
    assert.equal(idx.resolve('wiki/alpha.md', { kind: 'wiki', target: 'Beta' }).path, 'wiki/beta.md');
    assert.equal(idx.resolve('wiki/alpha.md', { kind: 'wiki', target: 'beta.MD' }).path, 'wiki/beta.md');
  });

  it('wiki: alias로 해석한다', () => {
    const r = idx.resolve('projects/demo/README.md', { kind: 'wiki', target: '알파' });
    assert.deepEqual(r, { path: 'wiki/alpha.md', candidates: [] });
  });

  it('wiki: 경로 접미사', () => {
    const r = idx.resolve('wiki/alpha.md', { kind: 'wiki', target: 'projects/demo/README' });
    assert.deepEqual(r, { path: 'projects/demo/README.md', candidates: [] });
    assert.equal(idx.resolve('wiki/alpha.md', { kind: 'wiki', target: 'demo/README' }).path, 'projects/demo/README.md');
  });

  it('wiki: 없으면 null', () => {
    assert.deepEqual(idx.resolve('wiki/alpha.md', { kind: 'wiki', target: '없음' }), { path: null, candidates: [] });
  });

  it('md: 상대경로', () => {
    const src = 'projects/demo/README.md';
    assert.equal(idx.resolve(src, { kind: 'md', target: '../' }).path, null);
    assert.equal(idx.resolve(src, { kind: 'md', target: '../../wiki/beta.md' }).path, 'wiki/beta.md');
    assert.equal(idx.resolve(src, { kind: 'md', target: './beta.md' }).path, 'projects/demo/beta.md');
    assert.equal(idx.resolve('wiki/alpha.md', { kind: 'md', target: '../projects/demo/' }).path, 'projects/demo/README.md');
  });

  it('md: 앞이 /인 대상은 null이다', () => {
    assert.equal(idx.resolve('wiki/alpha.md', { kind: 'md', target: '/beta.md' }).path, null);
    assert.equal(idx.resolve('wiki/alpha.md', { kind: 'md', target: '/wiki/beta.md' }).path, null);
  });

  it('md: 볼트 밖은 null', () => {
    assert.equal(idx.resolve('wiki/alpha.md', { kind: 'md', target: '../../x.md' }).path, null);
    assert.equal(idx.resolve('alpha.md', { kind: 'md', target: '../wiki/beta.md' }).path, null);
  });

  it('raw/beta.md는 어느 해석에도 안 나온다', () => {
    for (const t of ['beta', 'raw/beta']) {
      const r = idx.resolve('wiki/alpha.md', { kind: 'wiki', target: t });
      assert.ok(!r.candidates.includes('raw/beta.md'));
      assert.notEqual(r.path, 'raw/beta.md');
    }
    assert.equal(idx.resolve('wiki/alpha.md', { kind: 'md', target: '../raw/beta.md' }).path, null);
  });

  it('backlinks', () => {
    const bl = idx.backlinks('wiki/beta.md');
    // 보내는 문서마다 하나, 그 안의 링크 수를 센다.
    assert.deepEqual(bl.filter((b) => b.path === 'wiki/alpha.md'), [{ path: 'wiki/alpha.md', title: '알파', count: 3 }]);
    assert.ok(bl.some((b) => b.path === 'projects/demo/README.md'));
    // 경로순, 경로마다 하나
    const keys = bl.map((b) => b.path);
    assert.deepEqual(keys, [...new Set(keys)].sort());
    // 자기 링크·없는 문서
    assert.deepEqual(idx.backlinks('wiki/INDEX.md').filter((b) => b.path === 'wiki/INDEX.md'), []);
  });

  it('outgoing은 정렬된 유일 목록이고 자기 자신을 뺀다', () => {
    assert.deepEqual(idx.outgoing('wiki/alpha.md'), ['projects/demo/README.md', 'wiki/beta.md']);
    assert.deepEqual(idx.outgoing('projects/demo/README.md'), ['wiki/alpha.md', 'wiki/beta.md']);
  });

  it('update: 링크를 더하면 역링크가 생기고 remove하면 사라진다', () => {
    assert.ok(!idx.backlinks('wiki/alpha.md').some((b) => b.path === 'wiki/beta.md'));
    const abs = path.join(fx.root, 'wiki/beta.md');
    fs.appendFileSync(abs, '\n돌아가기: [[alpha]]\n');
    idx.update('wiki/beta.md');
    const bl = idx.backlinks('wiki/alpha.md').filter((b) => b.path === 'wiki/beta.md');
    assert.equal(bl.length, 1);
    assert.equal(bl[0]?.title, '베타');
    assert.ok(idx.body('wiki/beta.md').includes('돌아가기'));
    idx.remove('wiki/beta.md');
    assert.ok(!idx.files.has('wiki/beta.md'));
    assert.ok(!idx.backlinks('wiki/alpha.md').some((b) => b.path === 'wiki/beta.md'));
    assert.deepEqual(idx.backlinks('wiki/beta.md'), []);
  });

  it('update: 링크를 지우면 역링크도 사라진다', () => {
    fs.writeFileSync(path.join(fx.root, 'wiki/alpha.md'), '# 알파\n\n링크 없음\n');
    idx.update('wiki/alpha.md');
    assert.ok(!idx.backlinks('wiki/beta.md').some((b) => b.path === 'wiki/alpha.md'));
    assert.deepEqual(idx.outgoing('wiki/alpha.md'), []);
  });

  it('update: 새 파일은 해석 표에 들어가고 기존 링크의 해석을 바꾼다', () => {
    fs.mkdirSync(path.join(fx.root, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(fx.root, 'notes/gamma.md'), '---\naliases: [감마]\n---\n\n# 감마\n\n[[alpha]]\n');
    idx.update('notes/gamma.md');
    assert.ok(idx.files.has('notes/gamma.md'));
    assert.equal(idx.resolve('wiki/alpha.md', { kind: 'wiki', target: 'gamma' }).path, 'notes/gamma.md');
    assert.equal(idx.resolve('wiki/alpha.md', { kind: 'wiki', target: '감마' }).path, 'notes/gamma.md');
    assert.equal(idx.resolve('wiki/alpha.md', { kind: 'wiki', target: 'notes/gamma' }).path, 'notes/gamma.md');
    assert.ok(idx.backlinks('wiki/alpha.md').some((b) => b.path === 'notes/gamma.md'));
    // 기존 문서가 새 파일을 가리키는 링크를 가졌다면 새로 해석된다
    fs.appendFileSync(path.join(fx.root, 'wiki/beta.md'), '\n[[감마]]\n');
    idx.update('wiki/beta.md');
    assert.ok(idx.backlinks('notes/gamma.md').some((b) => b.path === 'wiki/beta.md'));
    idx.remove('notes/gamma.md');
    assert.equal(idx.resolve('wiki/alpha.md', { kind: 'wiki', target: '감마' }).path, null);
    assert.ok(!idx.backlinks('notes/gamma.md').length);
    assert.ok(!idx.backlinks('wiki/alpha.md').some((b) => b.path === 'notes/gamma.md'));
  });

  it('update: 나중에 생긴 파일이 이미 있던 깨진 링크를 해석한다', () => {
    fs.appendFileSync(path.join(fx.root, 'wiki/beta.md'), '\n[[delta]]\n');
    idx.update('wiki/beta.md');
    assert.deepEqual(idx.backlinks('wiki/INDEX.md').filter((b) => b.path === 'wiki/beta.md'), []);
    fs.writeFileSync(path.join(fx.root, 'wiki/delta.md'), '# 델타\n');
    idx.update('wiki/delta.md');
    assert.ok(idx.backlinks('wiki/delta.md').some((b) => b.path === 'wiki/beta.md'));
  });

  it('update: 범위 밖 경로는 색인을 바꾸지 않는다', () => {
    const before = [...idx.files].sort();
    fs.writeFileSync(path.join(fx.root, 'raw/new.md'), '# 새\n');
    for (const p of ['raw/beta.md', 'raw/new.md', 'private/p.md', 'archive/x.md', '/abs/x.md', '../x.md', 'wiki/../raw/beta.md', 'node_modules/x.md', 'wiki/a.txt']) {
      idx.update(p);
    }
    assert.deepEqual([...idx.files].sort(), before);
    const r = idx.resolve('wiki/alpha.md', { kind: 'wiki', target: 'beta' });
    assert.ok(!r.candidates.includes('raw/beta.md'));
    assert.equal(idx.resolve('wiki/alpha.md', { kind: 'wiki', target: 'new' }).path, null);
  });

  it('wiki: alias는 경로 없는 이름에만 쓴다', () => {
    assert.equal(idx.resolve('wiki/b.md', { kind: 'wiki', target: 'x/알파' }).path, null);
  });

  it('update: 디스크에 없으면 remove와 같다', () => {
    fs.rmSync(path.join(fx.root, 'wiki/beta.md'));
    idx.update('wiki/beta.md');
    assert.ok(!idx.files.has('wiki/beta.md'));
  });

  it('kind·cluster: frontmatter 와 경로에서 판정한다', () => {
    assert.equal(idx.kind('wiki/alpha.md'), 'concept');
    assert.equal(idx.kind('projects/demo/README.md'), 'project');
    assert.equal(idx.cluster('wiki/alpha.md'), 'type:concept');
    assert.equal(idx.cluster('projects/demo/README.md'), 'project:demo');
    assert.deepEqual(idx.topics('wiki/alpha.md'), []);
  });

  it('update: 새 문서의 kind·topics·cluster 와 degree 가 반영된다', () => {
    assert.deepEqual(idx.degree('wiki/alpha.md'), { in: 2, out: 2 });
    fs.writeFileSync(path.join(fx.root, 'wiki/zeta.md'), '---\ntype: tool\ntopics: [ctx]\n---\n# 제타\n\n[[alpha]]\n');
    idx.update('wiki/zeta.md');
    assert.equal(idx.kind('wiki/zeta.md'), 'tool');
    assert.deepEqual(idx.topics('wiki/zeta.md'), ['ctx']);
    assert.equal(idx.cluster('wiki/zeta.md'), 'topic:ctx');
    assert.deepEqual(idx.degree('wiki/alpha.md'), { in: 3, out: 2 });
  });

  it('version: build 뒤 1 이고 update·remove 마다 1 씩 는다', () => {
    assert.equal(idx.version, 1);
    idx.update('wiki/alpha.md');
    assert.equal(idx.version, 2);
    idx.remove('wiki/alpha.md');
    assert.equal(idx.version, 3);
    // 색인에 없는 문서를 빼는 것은 바뀐 것이 없다.
    idx.remove('wiki/alpha.md');
    assert.equal(idx.version, 3);
    // 범위 밖 경로의 update 도 바뀐 것이 없다.
    idx.update('raw/beta.md');
    assert.equal(idx.version, 3);
  });

  it('version: 새 인덱스는 0 에서 시작한다', () => {
    assert.equal(new VaultIndex(fx.root).version, 0);
  });

  it('캐시로 복원한 문서도 parse 와 같은 kind·topics 를 낸다', () => {
    fs.writeFileSync(path.join(fx.root, 'wiki/zeta.md'), '---\ntype: tool\ntopics: [ctx]\n---\n# 제타\n');
    idx.update('wiki/zeta.md');
    const cache = idx.snapshot();
    const warm = new VaultIndex(fx.root);
    const stats = warm.build({ cache });
    assert.equal(stats.parsed, 0);
    assert.equal(warm.kind('wiki/zeta.md'), 'tool');
    assert.deepEqual(warm.topics('wiki/zeta.md'), ['ctx']);
    assert.equal(warm.cluster('wiki/zeta.md'), 'topic:ctx');
  });
});
