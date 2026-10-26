// 임베딩 묶음의 화면 상태(src/graph/embedding.ts) — 상태 글, 선택 가능 여부, 켜기·색인·3 초 폴링, 저장 키. fetch·타이머는 가짜다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withStorage } from '../helpers/fake-storage.ts';
import { readGraphEmbedding, writeGraphEmbedding } from '../../src/app/prefs/graph.ts';
import {
  BUILD_PATH,
  EMBED_POLL_MS,
  STATUS_PATH,
  createEmbeddingStore,
  embeddingDisabledReason,
  embeddingReady,
  embeddingStatusText,
  embeddingToken,
  type EmbedStatus,
  type EmbeddingView,
} from '../../src/graph/embedding.ts';

const st = (over: Partial<EmbedStatus>): EmbedStatus => ({ state: 'idle', model: 'embeddinggemma-2:270m-q8_0-text', done: 0, total: 10, failed: 0, builtAt: null, clusters: 0, ...over });
const view = (over: Partial<EmbeddingView>): EmbeddingView => ({ available: true, model: 'embeddinggemma-2:270m-q8_0-text', enabled: true, status: null, error: null, ...over });

test('저장 키 knowledge-viewer.graph-embedding: 기본 꺼짐, 켜면 1', () => {
  const store = new Map<string, string>();
  withStorage(store, () => {
    assert.equal(readGraphEmbedding(), false);
    writeGraphEmbedding(true);
    assert.equal(store.get('knowledge-viewer.graph-embedding'), '1');
    assert.equal(readGraphEmbedding(), true);
    writeGraphEmbedding(false);
    assert.equal(readGraphEmbedding(), false);
  });
});

test('상태 글: 꺼짐·Ollama 없음·모델 없음(안내 명령)·색인 중 n/N·준비됨 k 군집', () => {
  assert.equal(embeddingStatusText(view({ enabled: false })), '꺼짐');
  assert.equal(embeddingStatusText(view({})), '확인 중…');
  assert.match(embeddingStatusText(view({ status: st({ state: 'no-ollama' }) })), /^Ollama 없음/);
  assert.equal(embeddingStatusText(view({ status: st({ state: 'no-model', hint: 'ollama pull embeddinggemma-2:270m-q8_0-text' }) })), '모델 없음 — ollama pull embeddinggemma-2:270m-q8_0-text');
  assert.equal(embeddingStatusText(view({ status: st({ state: 'building', done: 3, total: 10 }) })), '색인 중 3/10');
  assert.equal(embeddingStatusText(view({ status: st({ state: 'ready', done: 10, clusters: 4 }) })), '준비됨 · 4 군집');
  assert.equal(embeddingStatusText(view({ status: st({ state: 'ready', done: 8, clusters: 4, failed: 1 }) })), '준비됨 · 4 군집 · 낡음 2 · 실패 1');
  assert.equal(embeddingStatusText(view({ status: st({ state: 'idle' }) })), '색인 전');
  assert.equal(
    embeddingStatusText(view({ status: st({ state: 'ready', done: 10, clusters: 4, hint: 'Ollama 가 꺼져 있다' }) })),
    '준비됨 · 4 군집 · 색인 못 함: Ollama 가 꺼져 있다',
  );
});

test('선택 가능: 서버가 알리고·켰고·준비됐을 때만. 표지는 군집 시각', () => {
  const ready = view({ status: st({ state: 'ready', builtAt: '2026-10-24T00:00:00Z' }) });
  assert.equal(embeddingReady(ready), true);
  assert.equal(embeddingToken(ready), '2026-10-24T00:00:00Z');
  assert.equal(embeddingDisabledReason(ready), null);
  assert.equal(embeddingReady({ ...ready, enabled: false }), false);
  assert.equal(embeddingToken({ ...ready, available: false }), undefined);
  assert.match(embeddingDisabledReason({ ...ready, enabled: false })!, /켜야/);
  assert.match(embeddingDisabledReason(view({ status: st({ state: 'no-ollama' }) }))!, /Ollama 없음/);
});

type Call = { url: string; method?: string };
function harness(enabled: boolean, replies: EmbedStatus[]) {
  const calls: Call[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean; fired: boolean }[] = [];
  let saved = enabled;
  const store = createEmbeddingStore({
    fetch: async (url, init) => {
      calls.push({ url, method: init?.method });
      const body = replies.shift() ?? st({ state: 'ready' });
      return { ok: true, status: 200, json: async () => body };
    },
    readEnabled: () => saved,
    writeEnabled: (on) => {
      saved = on;
    },
    setTimeout: (fn, ms) => {
      const t = { fn: () => {}, ms, cleared: false, fired: false };
      t.fn = () => {
        t.fired = true;
        fn();
      };
      timers.push(t);
      return t;
    },
    clearTimeout: (t) => {
      (t as { cleared: boolean }).cleared = true;
    },
  });
  const live = () => timers.filter((t) => !t.cleared && !t.fired);
  return { store, calls, timers, live, saved: () => saved };
}
const tick = () => new Promise((r) => setImmediate(r));

test('서버가 알리지 않으면(available: false) 켜져 있어도 묻지 않는다', async () => {
  const h = harness(true, []);
  h.store.setAvailable({ available: false, model: null });
  await tick();
  assert.equal(h.calls.length, 0);
  h.store.setAvailable(undefined);
  await tick();
  assert.equal(h.calls.length, 0);
});

test('켜 두고 다음 세션: available 을 받으면 상태를 다시 묻는다(색인은 시작하지 않는다)', async () => {
  const h = harness(true, [st({ state: 'idle' })]);
  h.store.setAvailable({ available: true, model: 'embeddinggemma-2:270m-q8_0-text' });
  await tick();
  await tick();
  assert.deepEqual(h.calls, [{ url: STATUS_PATH, method: undefined }]);
  assert.equal(h.store.get().status?.state, 'idle');
});

test('켜면 상태를 묻고 색인 전이면 색인 시작, 색인 중엔 3 초마다 묻고 준비되면 멈춘다', async () => {
  const h = harness(false, [st({ state: 'idle' }), st({ state: 'building', done: 0 }), st({ state: 'building', done: 5 }), st({ state: 'ready', done: 10, clusters: 2, builtAt: 't' })]);
  h.store.setAvailable({ available: true, model: 'embeddinggemma-2:270m-q8_0-text' });
  await tick();
  assert.equal(h.calls.length, 0, '꺼져 있으면 묻지 않는다');
  await h.store.setEnabled(true);
  assert.equal(h.saved(), true);
  assert.deepEqual(h.calls, [{ url: STATUS_PATH, method: undefined }, { url: BUILD_PATH, method: 'POST' }]);
  assert.equal(h.store.get().status?.state, 'building');
  assert.equal(h.live().length, 1);
  assert.equal(h.live()[0]!.ms, EMBED_POLL_MS);
  h.live()[0]!.fn();
  await tick();
  await tick();
  assert.equal(h.store.get().status?.done, 5);
  assert.equal(h.live().length, 1, '아직 색인 중이라 다시 걸었다');
  h.live()[0]!.fn();
  await tick();
  await tick();
  assert.equal(h.store.get().status?.state, 'ready');
  assert.equal(h.live().length, 0, '준비되면 폴링이 멈춘다');
  assert.equal(embeddingReady(h.store.get()), true);
});

test('끄면 저장하고 폴링을 멈춘다', async () => {
  const h = harness(true, [st({ state: 'building' })]);
  h.store.setAvailable({ available: true, model: 'embeddinggemma-2:270m-q8_0-text' });
  await tick();
  await tick();
  assert.equal(h.live().length, 1);
  await h.store.setEnabled(false);
  assert.equal(h.saved(), false);
  assert.equal(h.live().length, 0);
  assert.equal(embeddingStatusText(h.store.get()), '꺼짐');
});

test('Ollama 가 없으면 켜도 색인을 시작하지 않는다', async () => {
  const h = harness(false, [st({ state: 'no-ollama' })]);
  h.store.setAvailable({ available: true, model: 'embeddinggemma-2:270m-q8_0-text' });
  await h.store.setEnabled(true);
  assert.deepEqual(h.calls.map((c) => c.url), [STATUS_PATH]);
  assert.equal(embeddingReady(h.store.get()), false);
});
