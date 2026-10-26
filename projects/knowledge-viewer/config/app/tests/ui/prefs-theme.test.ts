// 화면 테마 설정 기억(prefs/theme.ts)과 <html> 속성 적용(theme-apply.ts의 applyTheme).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withStorage, withThrowingStorage } from '../helpers/fake-storage.ts';
import { readScheme, readTheme, writeScheme, writeTheme } from '../../src/app/prefs/theme.ts';
import { applyTheme } from '../../src/app/theme-apply.ts';

test('테마는 기본 vault, 저장한 id 를 돌려주고 모르는 id 는 기본으로', () => {
  const store = new Map<string, string>();
  withStorage(store, () => {
    assert.equal(readTheme(), 'vault');
    writeTheme('dracula');
    assert.equal(store.get('knowledge-viewer.theme'), 'dracula');
    assert.equal(readTheme(), 'dracula');
    writeTheme('no-such');
    assert.equal(store.get('knowledge-viewer.theme'), 'vault');
    store.set('knowledge-viewer.theme', 'removed-theme');
    assert.equal(readTheme(), 'vault');
  });
});

test('밝기는 기본 auto, light·dark 를 기억하고 모르는 값은 auto', () => {
  const store = new Map<string, string>();
  withStorage(store, () => {
    assert.equal(readScheme(), 'auto');
    writeScheme('dark');
    assert.equal(store.get('knowledge-viewer.scheme'), 'dark');
    assert.equal(readScheme(), 'dark');
    store.set('knowledge-viewer.scheme', 'dim');
    assert.equal(readScheme(), 'auto');
  });
});

test('localStorage 가 던지면 기본값, 쓰기는 조용히', () => {
  withThrowingStorage(() => {
    assert.equal(readTheme(), 'vault');
    assert.equal(readScheme(), 'auto');
    assert.doesNotThrow(() => writeTheme('github'));
    assert.doesNotThrow(() => writeScheme('light'));
  });
});

test('applyTheme: data-theme 는 늘 두고, auto 면 data-scheme 를 뺀다', () => {
  const el = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
  applyTheme(el, 'solarized', 'dark');
  assert.deepEqual({ ...el.dataset }, { theme: 'solarized', scheme: 'dark' });
  applyTheme(el, 'solarized', 'auto');
  assert.deepEqual({ ...el.dataset }, { theme: 'solarized' });
  applyTheme(el, 'gone', 'light');
  assert.deepEqual({ ...el.dataset }, { theme: 'vault', scheme: 'light' });
});
