// 검색 범위(raw·archive 포함) 기억: 기본 false.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withStorage, withThrowingStorage } from '../helpers/fake-storage.ts';
import { readSearchAll, writeSearchAll } from '../../src/app/prefs/search.ts';

test('검색 범위는 기본 false, 저장값 1 이면 true', () => {
  const store = new Map<string, string>();
  withStorage(store, () => {
    assert.equal(readSearchAll(), false);
    writeSearchAll(true);
    assert.equal(store.get('knowledge-viewer.search-all'), '1');
    assert.equal(readSearchAll(), true);
    writeSearchAll(false);
    assert.equal(readSearchAll(), false);
  });
});

test('localStorage 가 던지면 false, 쓰기는 조용히', () => {
  withThrowingStorage(() => {
    assert.equal(readSearchAll(), false);
    assert.doesNotThrow(() => writeSearchAll(true));
  });
});
