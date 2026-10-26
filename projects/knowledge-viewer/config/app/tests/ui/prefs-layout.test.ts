// 배치 설정: 왼쪽·오른쪽 열 폭 범위(순수), 왼쪽·오른쪽 열 펴기 기억.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withStorage, withThrowingStorage } from '../helpers/fake-storage.ts';
import {
  clampLeftWidth,
  clampRightWidth,
  LEFT_DEFAULT,
  LEFT_MAX,
  LEFT_MIN,
  readBookmarksOpen,
  readLeftOpen,
  readLeftWidth,
  readRightOpen,
  readRightWidth,
  RIGHT_DEFAULT,
  RIGHT_MAX,
  RIGHT_MIN,
  writeBookmarksOpen,
  writeLeftOpen,
  writeLeftWidth,
  writeRightOpen,
  writeRightWidth,
} from '../../src/app/prefs/layout.ts';

test('범위 안 값은 반올림해 그대로', () => {
  assert.equal(clampLeftWidth(300.4), 300);
  assert.equal(clampLeftWidth('320'), 320);
});

test('범위 밖은 끝값으로, 숫자가 아니면 기본값', () => {
  assert.equal(clampLeftWidth(10), LEFT_MIN);
  assert.equal(clampLeftWidth(9999), LEFT_MAX);
  assert.equal(clampLeftWidth('abc'), LEFT_DEFAULT);
  assert.equal(clampLeftWidth(null), LEFT_DEFAULT);
});

test('왼쪽 열 폭은 저장값을 범위로 잘라 읽고, 없으면 기본', () => {
  const store = new Map<string, string>();
  withStorage(store, () => {
    assert.equal(readLeftWidth(), LEFT_DEFAULT);
    writeLeftWidth(9999);
    assert.equal(store.get('knowledge-viewer.left-width'), String(LEFT_MAX));
    assert.equal(readLeftWidth(), LEFT_MAX);
  });
});

test('오른쪽 열 폭: 범위 안 값은 반올림해 그대로', () => {
  assert.equal(clampRightWidth(400.4), 400);
  assert.equal(clampRightWidth('320'), 320);
});

test('오른쪽 열 폭: 범위 밖은 끝값으로, 숫자가 아니면 기본값', () => {
  assert.equal(clampRightWidth(10), RIGHT_MIN);
  assert.equal(clampRightWidth(9999), RIGHT_MAX);
  assert.equal(clampRightWidth('abc'), RIGHT_DEFAULT);
  assert.equal(clampRightWidth(null), RIGHT_DEFAULT);
  assert.equal(clampRightWidth(''), RIGHT_DEFAULT);
});

test('오른쪽 열 폭은 저장값을 범위로 잘라 읽고, 없으면 기본', () => {
  const store = new Map<string, string>();
  withStorage(store, () => {
    assert.equal(readRightWidth(), RIGHT_DEFAULT);
    writeRightWidth(9999);
    assert.equal(store.get('knowledge-viewer.right-width'), String(RIGHT_MAX));
    assert.equal(readRightWidth(), RIGHT_MAX);
    store.set('knowledge-viewer.right-width', '10');
    assert.equal(readRightWidth(), RIGHT_MIN);
  });
});

test('왼쪽·오른쪽 열 펴기는 기본 true, 저장값 0 이면 false', () => {
  const store = new Map<string, string>();
  withStorage(store, () => {
    assert.equal(readLeftOpen(), true);
    assert.equal(readRightOpen(), true);
    writeLeftOpen(false);
    writeRightOpen(false);
    assert.equal(store.get('knowledge-viewer.left-open'), '0');
    assert.equal(store.get('knowledge-viewer.right-open'), '0');
    assert.equal(readLeftOpen(), false);
    assert.equal(readRightOpen(), false);
    writeLeftOpen(true);
    assert.equal(readLeftOpen(), true);
  });
});

test('localStorage 가 던지면 펴짐·기본 폭으로, 쓰기는 조용히', () => {
  withThrowingStorage(() => {
    assert.equal(readLeftOpen(), true);
    assert.equal(readRightOpen(), true);
    assert.equal(readLeftWidth(), LEFT_DEFAULT);
    assert.equal(readRightWidth(), RIGHT_DEFAULT);
    assert.doesNotThrow(() => writeLeftOpen(false));
    assert.doesNotThrow(() => writeLeftWidth(300));
    assert.doesNotThrow(() => writeRightWidth(400));
  });
});

test('트리 위 북마크 섹션 펴기는 기본 true, 저장값 0 이면 false', () => {
  const store = new Map<string, string>();
  withStorage(store, () => {
    assert.equal(readBookmarksOpen(), true);
    writeBookmarksOpen(false);
    assert.equal(store.get('knowledge-viewer.bookmarks-open'), '0');
    assert.equal(readBookmarksOpen(), false);
    writeBookmarksOpen(true);
    assert.equal(readBookmarksOpen(), true);
  });
  withThrowingStorage(() => {
    assert.equal(readBookmarksOpen(), true);
    assert.doesNotThrow(() => writeBookmarksOpen(false));
  });
});
