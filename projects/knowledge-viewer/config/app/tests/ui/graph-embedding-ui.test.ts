// 임베딩 묶음의 화면(SSR) — ⚙ 설정의 "지도" 줄과 조절 패널의 `임베딩` 라디오. 서버가 알릴 때만 나온다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import { createEmbeddingStore, embeddingStore, type EmbedStatus } from '../../src/graph/embedding.ts';

const { SettingsPanel } = await import('../../src/app/SettingsMenu.tsx');
const { GraphControls } = await import('../../src/graph/GraphControls.tsx');

const noop = () => {};
const status = (over: Partial<EmbedStatus>): EmbedStatus => ({ state: 'idle', model: 'embeddinggemma-2:270m-q8_0-text', done: 0, total: 9, failed: 0, builtAt: null, clusters: 0, ...over });

/** 상태를 미리 채운 가짜 저장소(네트워크 없음). */
async function fakeStore(available: boolean, enabled: boolean, s: EmbedStatus | null) {
  const store = createEmbeddingStore({
    fetch: async () => ({ ok: true, status: 200, json: async () => s }),
    readEnabled: () => enabled,
    writeEnabled: noop,
    setTimeout: () => null,
    clearTimeout: noop,
  });
  store.setAvailable({ available, model: 'embeddinggemma-2:270m-q8_0-text' });
  await new Promise((r) => setImmediate(r));
  return store;
}

const panel = (embedding: Awaited<ReturnType<typeof fakeStore>>) =>
  renderToStaticMarkup(
    createElement(SettingsPanel, {
      src: { kind: 'local' },
      prs: [],
      mainAvailable: true,
      onSourceChange: noop,
      fallbackReason: null,
      searchAll: false,
      onSearchAll: noop,
      leftOpen: true,
      rightOpen: true,
      onToggleLeft: noop,
      onToggleRight: noop,
      embedding,
    }),
  );

test('⚙ 설정: 서버가 알리지 않으면 "지도" 줄이 없다', async () => {
  const html = panel(await fakeStore(false, false, null));
  assert.equal(html.includes('임베딩 묶음'), false);
});

test('⚙ 설정: 쓸 수 있으면 "지도 | 임베딩 묶음 [켜기] 상태" 줄, 꺼져 있으면 꺼짐·색인 단추 없음', async () => {
  const html = panel(await fakeStore(true, false, null));
  assert.match(html, /<span class="settings-h">지도<\/span>/);
  assert.match(html, /임베딩 묶음/);
  assert.match(html, /role="status">꺼짐</);
  assert.equal(html.includes('>색인<'), false);
});

test('⚙ 설정: 켜져 있으면 상태 글과 색인 단추 — 모델 없음은 안내 명령(받은 뒤 바로 누른다), 색인 중엔 단추를 막는다', async () => {
  const noModel = panel(await fakeStore(true, true, status({ state: 'no-model', hint: 'ollama pull embeddinggemma-2:270m-q8_0-text' })));
  assert.match(noModel, /모델 없음 — ollama pull embeddinggemma-2:270m-q8_0-text/);
  assert.match(noModel, /<button type="button" class="settings-link" title="[^"]*">색인<\/button>/);
  const building = panel(await fakeStore(true, true, status({ state: 'building', done: 4 })));
  assert.match(building, /색인 중 4\/9/);
  assert.match(building, /<button[^>]*disabled=""[^>]*>색인<\/button>/);
  const ready = panel(await fakeStore(true, true, status({ state: 'ready', done: 9, clusters: 3 })));
  assert.match(ready, /준비됨 · 3 군집/);
  assert.match(ready, /<button type="button" class="settings-link" title="[^"]*">색인<\/button>/);
});

const controls = () =>
  renderToStaticMarkup(
    createElement(GraphControls, {
      depth: 2,
      mode: '3d',
      all: false,
      hubs: 'keep',
      labels: 'major',
      motion: 'smooth',
      damping: 'medium',
      cluster: 'embedding',
      rotate: 'off',
      orbit: 'on',
      onChange: noop,
      legend: [],
    }),
  );

test('조절 패널: 서버가 알리지 않으면 묶음 셋, 임베딩을 저장해 두었어도 메타가 찍힌다', () => {
  embeddingStore.setAvailable(undefined);
  const html = controls();
  assert.equal(html.includes('value="embedding"'), false);
  assert.match(html, /checked="" value="meta"/);
});

test('조절 패널: 쓸 수 있으면 넷째 항목 임베딩 — 켜고 준비되기 전엔 비활성이고 title 에 사유', () => {
  embeddingStore.setAvailable({ available: true, model: 'embeddinggemma-2:270m-q8_0-text' });
  try {
    const html = controls();
    assert.match(html, /<label title="⚙ 설정의 지도 › 임베딩 묶음을 켜야 고를 수 있다"><input type="radio" disabled="" name="graph-cluster" value="embedding"\/>임베딩<\/label>/);
    assert.match(html, /checked="" value="meta"/);
    const order = [...html.matchAll(/name="graph-cluster"[^>]*value="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(order, ['meta', 'community', 'embedding', 'none']);
  } finally {
    embeddingStore.setAvailable(undefined);
  }
});
