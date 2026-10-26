// 원격 이미지 설정(prefs/images.ts) — 토글 기본 끔, 허용 호스트 기본값·깨진 저장값.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readRemoteImageHosts, readRemoteImages, writeRemoteImageHosts, writeRemoteImages } from '../../src/app/prefs.ts';
import { withStorage, withThrowingStorage } from '../helpers/fake-storage.ts';

const KEY = 'knowledge-viewer.remote-images';
const HOSTS = 'knowledge-viewer.remote-image-hosts';
const DEFAULT = ['image.lemoncloud.io', 'file.eureka.codes'];

test('readRemoteImages: 기본은 끔, 1 이면 켬, 그 밖은 끔', () => {
  assert.equal(withStorage(new Map(), readRemoteImages), false);
  assert.equal(withStorage(new Map([[KEY, '1']]), readRemoteImages), true);
  assert.equal(withStorage(new Map([[KEY, 'true']]), readRemoteImages), false);
  assert.equal(withThrowingStorage(readRemoteImages), false);
});

test('writeRemoteImages: 1·0 으로 적고 다시 읽힌다', () => {
  const m = new Map<string, string>();
  withStorage(m, () => writeRemoteImages(true));
  assert.equal(m.get(KEY), '1');
  assert.equal(withStorage(m, readRemoteImages), true);
  withStorage(m, () => writeRemoteImages(false));
  assert.equal(m.get(KEY), '0');
  withThrowingStorage(() => writeRemoteImages(true)); // 던지지 않는다
});

test('readRemoteImageHosts: 없으면·깨졌으면·배열 아니면 기본값, 빈 배열은 그대로', () => {
  assert.deepEqual(withStorage(new Map(), readRemoteImageHosts), DEFAULT);
  assert.deepEqual(withStorage(new Map([[HOSTS, '{not json']]), readRemoteImageHosts), DEFAULT);
  assert.deepEqual(withStorage(new Map([[HOSTS, '"image.lemoncloud.io"']]), readRemoteImageHosts), DEFAULT);
  assert.deepEqual(withStorage(new Map([[HOSTS, '[]']]), readRemoteImageHosts), []);
  assert.deepEqual(withThrowingStorage(readRemoteImageHosts), DEFAULT);
});

test('readRemoteImageHosts: 꼴이 아닌 칸·문자열 아닌 칸은 버리고 소문자·중복 제거', () => {
  const m = new Map([[HOSTS, JSON.stringify(['Miro.Medium.com', 3, '*', 'miro.medium.com', '*.googleusercontent.com', 'a/b'])]]);
  assert.deepEqual(withStorage(m, readRemoteImageHosts), ['miro.medium.com', '*.googleusercontent.com']);
});

test('writeRemoteImageHosts: JSON 배열로 적고 다시 읽힌다', () => {
  const m = new Map<string, string>();
  withStorage(m, () => writeRemoteImageHosts(['image.lemoncloud.io', 'miro.medium.com']));
  assert.equal(m.get(HOSTS), '["image.lemoncloud.io","miro.medium.com"]');
  assert.deepEqual(withStorage(m, readRemoteImageHosts), ['image.lemoncloud.io', 'miro.medium.com']);
});
