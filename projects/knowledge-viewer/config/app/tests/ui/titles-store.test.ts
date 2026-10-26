// 제목 저장소: 한 번만 받고, 변경 알림은 모아서 다시 받는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTitlesStore } from '../../src/app/titles.ts';

test('ensure 는 한 번만 받고, invalidate 는 받아 둔 뒤에만 모아서 다시 받는다', async () => {
  let calls = 0;
  const store = createTitlesStore(async () => {
    calls += 1;
    return { items: [{ path: 'wiki/a.md', title: `A${calls}` }] };
  }, 5);
  store.invalidate(); // 아직 없다 — 아무것도 안 한다.
  assert.equal(calls, 0);
  store.ensure();
  store.ensure();
  assert.equal(store.get().state, 'loading');
  await store.settled();
  assert.equal(calls, 1);
  assert.equal(store.get().items?.[0]?.item.title, 'A1');
  assert.deepEqual(store.get().items?.[0]?.title.chars, ['a', '1']);
  store.invalidate();
  store.invalidate();
  await new Promise((r) => setTimeout(r, 20));
  await store.settled();
  assert.equal(calls, 2);
  assert.equal(store.get().items?.[0]?.item.title, 'A2');
});

test('실패하면 error 상태이고 옛 목록은 둔다', async () => {
  let fail = false;
  const store = createTitlesStore(async () => {
    if (fail) throw new Error('x');
    return { items: [{ path: 'a.md', title: 'A' }] };
  }, 1);
  store.ensure();
  await store.settled();
  fail = true;
  store.invalidate();
  await new Promise((r) => setTimeout(r, 10));
  await store.settled();
  assert.equal(store.get().state, 'error');
  assert.equal(store.get().items?.length, 1);
});
