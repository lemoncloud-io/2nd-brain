// /api/doc 의 embeds — 노트 임베드 1단계, 절 추출, 순환, 싣지 않는 것(이미지·파일·블록 참조·private·해석 못 함), 소스(local·main·pr) 유지.
import { after, before, describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { collectEmbeds, EMBED_LIMIT, type ResolvedLink } from '../../server/embeds.ts';
import { createViewerServer } from '../../server/main.ts';
import { SourceManager } from '../../server/source.ts';
import { extractLinks } from '../../shared/links.ts';
import { makeGitFixture, type GitFixture } from '../helpers/git-fixture.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const HOST = [
  '---',
  'type: concept',
  'cover: "![[beta]]"',
  '---',
  '',
  '# 호스트',
  '',
  '![[beta]]',
  '',
  '![[beta#둘째]]',
  '',
  '![[beta#없는 절]]',
  '',
  '![[host]]',
  '',
  '![[gamma]]',
  '',
  '![[img.png|460]] ![[doc.pdf]] ![[beta#^blk]] ![[p]] ![[private/p]] ![[nope]]',
  '',
  '`![[beta]]` 는 코드다.',
  '',
].join('\n');
const GAMMA = '# 감마\n\n감마 본문.\n\n![[host]]\n\n[[beta|베타로]]\n';
const PR_BETA = '---\ntype: concept\n---\n\n# 베타\n\nPR 에서 고친 베타 본문.\n\n## 둘째\n\nPR 둘째 절.\n';

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

describe('/api/doc embeds', () => {
  let fx: GitFixture;
  let distTmp: string;
  let server: http.Server;
  let base: string;

  before(async () => {
    fx = makeGitFixture();
    fx.commitOnMaster({ 'wiki/host.md': HOST, 'wiki/gamma.md': GAMMA }, 'embeds');
    fx.openPr(1, 'master', { 'wiki/beta.md': PR_BETA }, 'PR 1');
    // 디스크에만 있는 private 문서(커밋하지 않는다).
    fs.writeFileSync(path.join(fx.root, 'private', 'emb.md'), '# 비공개 호스트\n\n![[beta]]\n\n![[p]]\n');
    distTmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kv-dist-'));
    server = createViewerServer({
      root: fx.root,
      includePrivate: true,
      distDir: path.join(distTmp, 'dist'),
      watch: false,
      gh: fx.gh,
      sources: new SourceManager(fx.root, { gh: fx.gh }),
      log: () => {},
    });
    base = await listen(server);
  });
  after(async () => {
    await close(server);
    fx.cleanup();
    fs.rmSync(distTmp, { recursive: true, force: true });
  });

  const get = async (p: string): Promise<{ status: number; json: Json }> => {
    const res = await fetch(base + p);
    return { status: res.status, json: (await res.json()) as Json };
  };

  it('노트만 1단계로 싣는다 — 이미지·파일·블록 참조·private·해석 못 함·frontmatter·코드는 뺀다', async () => {
    const { status, json } = await get('/api/doc?path=wiki/host.md');
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(json.embeds).sort(), ['beta', 'beta#둘째', 'beta#없는 절', 'gamma', 'host'].sort());
  });

  it('전체 임베드: 제목·본문·첫 줄·제목 목록·그 문서 기준 링크', async () => {
    const { json } = await get('/api/doc?path=wiki/host.md');
    const e = json.embeds.beta;
    assert.equal(e.status, 'ok');
    assert.equal(e.path, 'wiki/beta.md');
    assert.equal(e.title, '베타');
    assert.equal(e.anchor, null);
    assert.match(e.body, /본문이다\./);
    assert.match(e.body, /둘째 절이다\./);
    const fileLines = fs.readFileSync(path.join(fx.root, 'wiki', 'beta.md'), 'utf8').split('\n');
    assert.equal(fileLines[e.bodyStartLine - 1], e.body.split('\n')[0]);
    assert.deepEqual(e.headings.map((h: Json) => [h.text, fileLines[h.line - 1]]), [
      ['베타', '# 베타'],
      ['둘째', '## 둘째'],
    ]);
  });

  it('#절: 그 제목부터 다음 같은 급 제목 앞까지, 첫 줄은 원문 파일 줄', async () => {
    const { json } = await get('/api/doc?path=wiki/host.md');
    const e = json.embeds['beta#둘째'];
    assert.equal(e.status, 'ok');
    assert.equal(e.anchor, '둘째');
    assert.equal(e.body, '## 둘째\n\n둘째 절이다.');
    const fileLines = fs.readFileSync(path.join(fx.root, 'wiki', 'beta.md'), 'utf8').split('\n');
    assert.equal(fileLines[e.bodyStartLine - 1], '## 둘째');
    assert.deepEqual(json.embeds['beta#없는 절'], { status: 'no-section', path: 'wiki/beta.md', title: '베타', anchor: '없는 절' });
  });

  it('자기 자신은 순환, 임베드 안의 임베드는 싣지 않고 그 문서 기준 링크만 준다', async () => {
    const { json } = await get('/api/doc?path=wiki/host.md');
    assert.deepEqual(json.embeds.host, { status: 'circular', path: 'wiki/host.md' });
    const g = json.embeds.gamma;
    assert.equal(g.status, 'ok');
    assert.match(g.body, /!\[\[host\]\]/);
    assert.equal(g.embeds, undefined);
    const back = g.links.find((l: Json) => l.target === 'host');
    assert.equal(back.path, 'wiki/host.md');
    assert.equal(back.embed, true);
    assert.equal(g.links.find((l: Json) => l.target === 'beta').path, 'wiki/beta.md');
  });

  it('임베드가 없는 문서는 embeds 를 싣지 않는다', async () => {
    const { json } = await get('/api/doc?path=wiki/beta.md');
    assert.equal(json.embeds, undefined);
  });

  it('private 대상은 이름으로도 경로로도 싣지 않는다 — private 문서(includePrivate)에서도 lint 범위만 푼다', async () => {
    const host = await get('/api/doc?path=wiki/host.md');
    assert.ok(!JSON.stringify(host.json.embeds).includes('비공개'));
    const priv = await get('/api/doc?path=private/emb.md');
    assert.equal(priv.status, 200);
    assert.deepEqual(Object.keys(priv.json.embeds), ['beta']);
  });

  it('git 소스(main·pr)는 그 소스의 본문을 싣는다', async () => {
    const main = await get('/api/doc?path=wiki/host.md&src=main');
    assert.equal(main.status, 200);
    assert.match(main.json.embeds.beta.body, /본문이다\./);
    const pr = await get('/api/doc?path=wiki/host.md&src=pr:1');
    assert.equal(pr.status, 200);
    assert.match(pr.json.embeds.beta.body, /PR 에서 고친 베타 본문/);
    assert.equal(pr.json.embeds['beta#둘째'].body, '## 둘째\n\nPR 둘째 절.');
  });
});

// 해석기·리더를 갈아 끼워 경계 검사만 본다.
const PRIVATE_TEXT = '# 비밀\n\n비밀 본문.\n';

function linksOf(md: string, to: string | null): ResolvedLink[] {
  return extractLinks(md).map((l) => ({ ...l, path: to, candidates: [] }));
}

test('collectEmbeds: 해석이 private 를 가리켜도 범위 밖이면 싣지 않는다(git 소스는 includePrivate false)', () => {
  const input = {
    rel: 'wiki/a.md',
    links: linksOf('![[p]]', 'private/p.md'),
    bodyStartLine: 1,
    read: () => PRIVATE_TEXT,
    resolve: () => ({ path: null, candidates: [] }),
  };
  assert.deepEqual(collectEmbeds({ ...input, scope: { includePrivate: false } }), {});
  // 디스크 + includePrivate 일 때만 리더가 준 것을 싣는다.
  assert.equal(collectEmbeds({ ...input, scope: { includePrivate: true } }).p?.status, 'ok');
});

test('collectEmbeds: 제외 폴더·`..` 경로는 싣지 않고, 리더가 null 이면 뺀다', () => {
  const base = { rel: 'wiki/a.md', bodyStartLine: 1, resolve: () => ({ path: null, candidates: [] }), scope: { includePrivate: true } };
  assert.deepEqual(collectEmbeds({ ...base, links: linksOf('![[x]]', 'node_modules/x.md'), read: () => 'x' }), {});
  assert.deepEqual(collectEmbeds({ ...base, links: linksOf('![[x]]', '../x.md'), read: () => 'x' }), {});
  assert.deepEqual(collectEmbeds({ ...base, links: linksOf('![[x]]', 'wiki/x.md'), read: () => null }), {});
});

test(`collectEmbeds: 한 문서에 ${EMBED_LIMIT} 개까지만 싣는다`, () => {
  const md = Array.from({ length: EMBED_LIMIT + 5 }, (_, i) => `![[n${i}]]`).join('\n\n');
  const links = extractLinks(md).map((l) => ({ ...l, path: `wiki/${l.target}.md`, candidates: [] }));
  const out = collectEmbeds({ rel: 'wiki/a.md', links, bodyStartLine: 1, read: () => '# x\n', resolve: () => ({ path: null, candidates: [] }), scope: { includePrivate: false } });
  assert.equal(Object.keys(out).length, EMBED_LIMIT);
});
