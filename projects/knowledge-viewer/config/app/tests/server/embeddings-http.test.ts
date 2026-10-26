// 임베딩 묶음의 HTTP 면 — /api/info 플래그, 색인 시작(POST 하나만·같은 출처만), 상태, /api/graph 의 embedCluster, CLI 인자.
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createViewerServer, parseArgs } from '../../server/main.ts';
import { makeFixtureVault } from '../helpers/fixture.ts';
import { startFakeOllama, type FakeOllama } from '../helpers/fake-ollama.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let fx: ReturnType<typeof makeFixtureVault>;
let tmp: string;
let ollama: FakeOllama;
let server: http.Server;
let base: string;

async function start(embeddings: Parameters<typeof createViewerServer>[0]['embeddings']): Promise<void> {
  server = createViewerServer({ root: fx.root, includePrivate: true, distDir: path.join(tmp, 'dist'), watch: false, log: () => {}, embeddings });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  fx = makeFixtureVault();
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kv-embed-http-'));
  ollama = await startFakeOllama();
});
afterEach(async () => {
  await new Promise<void>((r) => {
    server.close(() => r());
    server.closeAllConnections();
  });
  await ollama.close();
  fx.cleanup();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const getJson = async (p: string): Promise<{ status: number; json: Json }> => {
  const res = await fetch(base + p);
  return { status: res.status, json: (await res.json()) as Json };
};

async function waitReady(): Promise<Json> {
  for (let i = 0; i < 100; i += 1) {
    const { json } = await getJson('/api/graph/embeddings/status');
    if (json.state !== 'building') return json;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('색인이 끝나지 않았다');
}

test('/api/info: 켜 두면 available·model, 끄면 available: false', async () => {
  await start({ ollamaUrl: ollama.url, cacheDir: tmp });
  assert.deepEqual((await getJson('/api/info')).json.embeddings, { available: true, model: 'embeddinggemma-2:270m-q8_0-text' });
  await new Promise<void>((r) => {
    server.close(() => r());
    server.closeAllConnections();
  });
  await start(false);
  assert.deepEqual((await getJson('/api/info')).json.embeddings, { available: false, model: null });
  assert.equal((await getJson('/api/graph/embeddings/status')).json.state, 'off');
});

test('색인 시작은 POST 만, 다른 출처는 403, 다른 경로의 POST 는 여전히 405', async () => {
  await start({ ollamaUrl: ollama.url, cacheDir: tmp });
  assert.equal((await getJson('/api/graph/embeddings/build')).status, 405);
  const cross = await fetch(base + '/api/graph/embeddings/build', { method: 'POST', headers: { Origin: 'http://evil.example' } });
  assert.equal(cross.status, 403);
  assert.equal((await fetch(base + '/api/graph', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/api/doc?path=wiki/alpha.md', { method: 'POST' })).status, 405);
  assert.equal(ollama.requests, 0, '거부된 요청은 Ollama 를 부르지 않는다');
});

test('서버 시작만으로는 색인하지 않고, 켠 뒤(POST) 군집이 지도 노드에 실린다', async () => {
  await start({ ollamaUrl: ollama.url, cacheDir: tmp });
  const idle = (await getJson('/api/graph/embeddings/status')).json;
  assert.equal(idle.state, 'idle');
  assert.equal(ollama.requests, 0);
  // 준비 전에는 embed 를 실어도 노드에 군집이 없다.
  const before = (await getJson('/api/graph?all=1&embed=x')).json;
  assert.equal(before.nodes.some((n: Json) => 'embedCluster' in n), false);

  const res = await fetch(base + '/api/graph/embeddings/build', { method: 'POST', headers: { Origin: base } });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as Json).state, 'building');
  const ready = await waitReady();
  assert.equal(ready.state, 'ready');
  assert.ok(ready.clusters >= 2);

  const g = (await getJson('/api/graph?all=1&embed=' + encodeURIComponent(ready.builtAt))).json;
  assert.ok(g.nodes.length > 0);
  for (const n of g.nodes) assert.match(n.embedCluster, /^#\d+ · /);
  // private 는 includePrivate 서버에서도 색인하지 않는다(지도에도 lint 범위 밖이다).
  assert.equal(ollama.inputs.some((t) => t.includes('비공개')), false);
  // embed 가 없으면 싣지 않는다(선택하지 않은 사용자의 응답은 그대로).
  const plain = (await getJson('/api/graph?all=1')).json;
  assert.equal(plain.nodes.some((n: Json) => 'embedCluster' in n), false);
});

test('CLI: --ollama-url·--embed-model·환경 변수, 루프백이 아니면 시작부터 거부, --no-embed', () => {
  const env = {} as NodeJS.ProcessEnv;
  const d = parseArgs([], env);
  assert.equal(d.embed, true);
  assert.equal(d.ollamaUrl, 'http://127.0.0.1:11434');
  assert.equal(d.embedModel, 'embeddinggemma-2:270m-q8_0-text');
  const e = parseArgs([], { KV_OLLAMA_URL: 'http://localhost:9999', KV_EMBED_MODEL: 'bge-m3' } as NodeJS.ProcessEnv);
  assert.equal(e.ollamaUrl, 'http://localhost:9999');
  assert.equal(e.embedModel, 'bge-m3');
  const c = parseArgs(['--ollama-url', 'http://127.0.0.1:1234', '--embed-model', 'embeddinggemma-2:740m'], { KV_EMBED_MODEL: 'x' } as NodeJS.ProcessEnv);
  assert.equal(c.ollamaUrl, 'http://127.0.0.1:1234');
  assert.equal(c.embedModel, 'embeddinggemma-2:740m');
  assert.equal(parseArgs(['--no-embed'], env).embed, false);
  assert.throws(() => parseArgs(['--ollama-url', 'http://10.1.2.3:11434'], env), /127\.0\.0\.1/);
  assert.throws(() => parseArgs([], { KV_OLLAMA_URL: 'https://ollama.example.com' } as NodeJS.ProcessEnv), /127\.0\.0\.1/);
  assert.throws(() => parseArgs(['--embed-model', '; rm -rf'], env), /embed-model/);
});
