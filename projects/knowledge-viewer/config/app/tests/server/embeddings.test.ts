// 임베딩 묶음 서버(server/embeddings.ts) — 루프백 거부, 캐시 위치·무효화, 상태 전이, 범위. Ollama 는 가짜 HTTP 서버다.
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  EmbeddingService,
  assertLoopbackUrl,
  decodeVec,
  defaultCacheDir,
  embedInput,
  encodeVec,
  modelMatches,
  nameClusters,
  vaultHash,
  EMBED_CHARS,
} from '../../server/embeddings.ts';
import { VaultIndex } from '../../server/index-store.ts';
import { makeFixtureVault } from '../helpers/fixture.ts';
import { deadOllamaUrl, startFakeOllama, type FakeOllama } from '../helpers/fake-ollama.ts';

/** 손으로 만든 색인. 본문을 바꿔 끼울 수 있다. */
function fakeIndex(docs: Record<string, string>) {
  const bodies = new Map(Object.entries(docs));
  return {
    bodies,
    index: {
      get files() {
        return new Set(bodies.keys());
      },
      title: (p: string) => path.basename(p, '.md'),
      body: (p: string) => bodies.get(p) ?? '',
      degree: (p: string) => ({ in: p.includes('hub') ? 9 : 1, out: 0 }),
    },
  };
}

const DOCS = {
  'wiki/a1.md': 'alpha 이야기',
  'wiki/a2.md': 'alpha 둘',
  'wiki/a3-hub.md': 'alpha 허브',
  'wiki/b1.md': 'beta 이야기',
  'wiki/b2.md': 'beta 둘',
  'wiki/b3.md': 'beta 셋',
  'wiki/g1.md': 'gamma 하나',
  'wiki/g2.md': 'gamma 둘',
};

let tmp: string;
let ollama: FakeOllama;
const quiet = () => {};

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kv-embed-'));
  ollama = await startFakeOllama();
});
afterEach(async () => {
  await ollama.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const service = (index: ConstructorParameters<typeof EmbeddingService>[0]['index'], over: Partial<ConstructorParameters<typeof EmbeddingService>[0]> = {}) =>
  new EmbeddingService({ root: '/vault/demo', index, ollamaUrl: ollama.url, cacheDir: tmp, log: quiet, ...over });

test('assertLoopbackUrl: 127.0.0.1·localhost·[::1] 만 받고, 밖으로 나가는 주소는 거부한다', () => {
  assert.equal(assertLoopbackUrl('http://127.0.0.1:11434'), 'http://127.0.0.1:11434');
  assert.equal(assertLoopbackUrl('http://localhost:11434/'), 'http://localhost:11434');
  assert.equal(assertLoopbackUrl('http://[::1]:11434'), 'http://[::1]:11434');
  for (const bad of ['http://10.0.0.5:11434', 'http://ollama.example.com', 'https://api.example.com/v1', 'http://127.0.0.2:11434', 'ftp://127.0.0.1', 'nope', 'http://u:p@127.0.0.1:11434']) {
    assert.throws(() => assertLoopbackUrl(bad), /Ollama/, bad);
  }
  assert.throws(() => new EmbeddingService({ root: '/v', index: fakeIndex({}).index, ollamaUrl: 'http://192.168.0.2:11434' }), /127\.0\.0\.1/);
});

test('캐시 위치: ~/.knowledge-viewer/<볼트 경로 sha1 앞 12자>/embeddings.json', () => {
  const h = vaultHash('/vault/demo');
  assert.match(h, /^[0-9a-f]{12}$/);
  assert.notEqual(h, vaultHash('/vault/other'));
  assert.equal(defaultCacheDir('/vault/demo', '/home/u'), path.join('/home/u', '.knowledge-viewer', h));
});

test('embedInput: 군집 프롬프트 + 제목 + 본문 앞 EMBED_CHARS 자', () => {
  const s = embedInput('제목', 'x'.repeat(EMBED_CHARS + 500));
  assert.equal(s, `task: clustering | query: 제목\n\n${'x'.repeat(EMBED_CHARS)}`);
});

test('벡터 부호화는 Float32 를 되살리고, 길이가 틀리면 null', () => {
  const v = [0.5, -1.25, 3];
  assert.deepEqual([...decodeVec(encodeVec(v), 3)!], v);
  assert.equal(decodeVec(encodeVec(v), 4), null);
});

test('modelMatches: 태그 없는 이름은 :latest 와 같다', () => {
  assert.equal(modelMatches('embeddinggemma:latest', 'embeddinggemma'), true);
  assert.equal(modelMatches('embeddinggemma', 'embeddinggemma'), true);
  assert.equal(modelMatches('embeddinggemma:300m', 'embeddinggemma:latest'), false);
  assert.equal(modelMatches('gemma2:latest', 'embeddinggemma'), false);
});

test('상태: Ollama 가 꺼져 있으면 no-ollama, build 도 시작하지 않는다', async () => {
  const s = service(fakeIndex(DOCS).index, { ollamaUrl: await deadOllamaUrl() });
  assert.equal((await s.status()).state, 'no-ollama');
  const b = await s.build();
  assert.equal(b.state, 'no-ollama');
  assert.equal(s.clusters(), null);
});

test('상태: 모델이 없으면 no-model 이고 받는 명령을 안내한다(자동으로 받지 않는다)', async () => {
  ollama.models = ['llama3.2-vision:latest'];
  const s = service(fakeIndex(DOCS).index);
  const st = await s.status();
  assert.equal(st.state, 'no-model');
  assert.equal(st.hint, 'ollama pull embeddinggemma-2:270m-q8_0-text');
  assert.equal((await s.build()).state, 'no-model');
  assert.equal(ollama.requests, 0);
});

test('상태 전이: idle → building → ready, 군집 이름은 #n · 연결 수 최다 문서 제목', async () => {
  const s = service(fakeIndex(DOCS).index);
  const idle = await s.status();
  assert.equal(idle.state, 'idle');
  assert.equal(idle.total, 8);
  assert.equal(idle.done, 0);
  const b = await s.build();
  assert.equal(b.state, 'building');
  assert.equal((await s.build()).state, 'building', '이미 돌고 있으면 진행률만');
  await s.whenIdle();
  const ready = await s.status();
  assert.equal(ready.state, 'ready');
  assert.equal(ready.done, 8);
  assert.equal(ready.failed, 0);
  assert.equal(ready.clusters, 2); // k = max(2, round(√(8/2))) = 2
  assert.ok(ready.builtAt !== null);
  const map = s.clusters()!;
  assert.equal(map.size, 8);
  // alpha 셋은 한 군집이고, 그 이름은 허브(연결 수 최다)의 제목이다.
  assert.equal(map.get('wiki/a1.md'), map.get('wiki/a3-hub.md'));
  assert.match(map.get('wiki/a1.md')!, /^#\d · a3-hub$/);
  assert.notEqual(map.get('wiki/a1.md'), map.get('wiki/b1.md'));
});

test('캐시: 절대경로를 적지 않고, 다음 서버(같은 캐시 폴더)는 묻자마자 ready 다', async () => {
  const fx = fakeIndex(DOCS);
  const s = service(fx.index, { root: tmp });
  await s.build();
  await s.whenIdle();
  const raw = fs.readFileSync(path.join(tmp, 'embeddings.json'), 'utf8');
  assert.equal(raw.includes(tmp), false);
  assert.equal(raw.includes('/vault/'), false);
  const file = JSON.parse(raw) as { model: string; items: { path: string; hash: string; model: string; dim: number; vec: string }[] };
  assert.equal(file.model, 'embeddinggemma-2:270m-q8_0-text');
  assert.deepEqual(file.items.map((i) => i.path), Object.keys(DOCS).sort());
  assert.deepEqual(Object.keys(file.items[0]!).sort(), ['dim', 'hash', 'model', 'path', 'vec']);

  const before = ollama.requests;
  const again = service(fx.index);
  const st = await again.status();
  assert.equal(st.state, 'ready');
  assert.equal(st.done, 8);
  assert.deepEqual([...again.clusters()!], [...s.clusters()!]);
  assert.equal(ollama.requests, before, '캐시만으로 준비된다');
});

test('준비된 뒤 Ollama 가 꺼지면 색인은 못 해도 ready 를 지키고 까닭을 싣는다', async () => {
  const fx = fakeIndex(DOCS);
  const s = service(fx.index);
  await s.build();
  await s.whenIdle();
  await ollama.close();
  const again = service(fx.index, { ollamaUrl: await deadOllamaUrl() });
  const st = await again.status();
  assert.equal(st.state, 'ready', '캐시만으로 준비된다');
  const b = await again.build();
  assert.equal(b.state, 'ready');
  assert.match(b.hint ?? '', /Ollama/);
  ollama = await startFakeOllama();
});

test('캐시 무효화: 본문이 바뀐 문서만 다시 벡터화한다', async () => {
  const fx = fakeIndex(DOCS);
  const s = service(fx.index);
  await s.build();
  await s.whenIdle();
  ollama.inputs.length = 0;
  fx.bodies.set('wiki/g2.md', 'gamma 바뀐 본문');
  const st = await s.status();
  assert.equal(st.state, 'ready');
  assert.equal(st.done, 7, '바뀐 문서는 낡음');
  await s.build();
  await s.whenIdle();
  assert.equal(ollama.inputs.length, 1);
  assert.match(ollama.inputs[0]!, /바뀐 본문/);
  assert.equal((await s.status()).done, 8);
});

test('캐시 무효화: 모델이 바뀌면 전부 다시 한다', async () => {
  ollama.models = ['embeddinggemma-2:270m-q8_0-text', 'other-embed:latest'];
  const fx = fakeIndex(DOCS);
  const s = service(fx.index);
  await s.build();
  await s.whenIdle();
  ollama.inputs.length = 0;
  const other = service(fx.index, { model: 'other-embed' });
  const st = await other.status();
  assert.equal(st.state, 'idle', '다른 모델의 캐시는 쓰지 않는다');
  assert.equal(st.done, 0);
  await other.build();
  await other.whenIdle();
  assert.equal(ollama.inputs.length, 8);
});

test('실패한 문서는 건너뛰고 세며, 나머지로 군집한다', async () => {
  ollama.failOn = 'beta 둘';
  const s = service(fakeIndex(DOCS).index);
  await s.build();
  await s.whenIdle();
  const st = await s.status();
  assert.equal(st.state, 'ready');
  assert.equal(st.failed, 1);
  assert.equal(st.done, 7);
  assert.equal(s.clusters()!.has('wiki/b2.md'), false);
});

test('범위: 실제 색인에서도 private·raw·node_modules·dist 는 색인하지 않는다', async () => {
  const fx = makeFixtureVault();
  try {
    const index = new VaultIndex(fx.root);
    index.build();
    const s = new EmbeddingService({ root: fx.root, index, ollamaUrl: ollama.url, cacheDir: tmp, log: quiet });
    const docs = s.scopeDocs();
    assert.ok(docs.length > 0);
    assert.equal(docs.some((p) => /^(private|raw|archive)\//.test(p) || p.includes('node_modules/') || p.startsWith('dist/')), false);
    await s.build();
    await s.whenIdle();
    assert.equal(ollama.inputs.some((t) => t.includes('비공개')), false);
    assert.equal((await s.status()).state, 'ready');
  } finally {
    fx.cleanup();
  }
});

test('nameClusters: 큰 군집부터 #1, 이름은 연결 수 최다(같으면 경로순) 제목', () => {
  const paths = ['a', 'b', 'c', 'd', 'e'];
  const assign = [1, 1, 0, 1, 0];
  const deg: Record<string, number> = { a: 1, b: 5, c: 2, d: 5, e: 2 };
  const m = nameClusters(paths, assign, 3, (p) => deg[p]!, (p) => p.toUpperCase());
  assert.equal(m.get('a'), '#1 · B');
  assert.equal(m.get('d'), '#1 · B');
  assert.equal(m.get('c'), '#2 · C');
  assert.equal(m.get('e'), '#2 · C');
});
