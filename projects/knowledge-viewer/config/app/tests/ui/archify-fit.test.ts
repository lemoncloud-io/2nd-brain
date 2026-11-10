// archify 틀 맞춤의 화면 쪽 — 받은 메시지 검사(보낸 창·출처·꼴), iframe 출처, 그림 배율 설정 저장.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { FIT_HEIGHT, FIT_READY } from '../../shared/archify-fit.ts';
import { readArchifyZoom, writeArchifyZoom } from '../../src/app/prefs.ts';
import { acceptFitMessage, fitChannel, frameMessageOrigin } from '../../src/archify/useArchifyFit.ts';
import { withStorage, withThrowingStorage } from '../helpers/fake-storage.ts';

const KEY = 'knowledge-viewer.archify-zoom';

test('acceptFitMessage: 이 iframe 창 + 같은 출처 + 맞는 꼴만 받는다', () => {
  const frameWin = {};
  const origin = 'http://localhost:8792';
  const ok = { source: frameWin, origin, data: { type: FIT_HEIGHT, height: 900 } };
  assert.deepEqual(acceptFitMessage(ok, frameWin, origin), { type: 'height', height: 900 });
  assert.deepEqual(acceptFitMessage({ ...ok, data: { type: FIT_READY } }, frameWin, origin), { type: 'ready' });
  // 다른 창, 다른 출처, 창 없음, 기대 출처 모름, 꼴 틀림은 모두 버린다.
  assert.equal(acceptFitMessage({ ...ok, source: {} }, frameWin, origin), null);
  assert.equal(acceptFitMessage({ ...ok, origin: 'http://localhost:9999' }, frameWin, origin), null);
  assert.equal(acceptFitMessage({ ...ok, origin: 'http://127.0.0.1:8792' }, frameWin, origin), null);
  assert.equal(acceptFitMessage(ok, null, origin), null);
  assert.equal(acceptFitMessage(ok, frameWin, ''), null);
  assert.equal(acceptFitMessage({ ...ok, data: { type: FIT_HEIGHT, height: 'x' } }, frameWin, origin), null);
});

test('frameMessageOrigin: 절대·상대 주소의 출처, 못 읽으면 빈 문자열', () => {
  assert.equal(frameMessageOrigin('http://localhost:8793/raw/@main/a.html?kv-fit=1#x', 'http://127.0.0.1:8792/v/a'), 'http://localhost:8793');
  assert.equal(frameMessageOrigin('/raw/a.html', 'http://127.0.0.1:8792/v/a'), 'http://127.0.0.1:8792');
  assert.equal(frameMessageOrigin('http://[bad', 'also bad'), '');
});

test('fitChannel: 보통은 iframe 출처로 받고 보낸다, 불투명 출처(개인 이름 뒤)면 null 로 받고 * 로 보낸다', () => {
  assert.deepEqual(fitChannel('http://localhost:8793/raw/@main/a.html?kv-fit=1', 'http://127.0.0.1:8792/v/a', false), {
    expected: 'http://localhost:8793',
    target: 'http://localhost:8793',
  });
  assert.deepEqual(fitChannel('/raw/@main/a.html?kv-fit=1', 'http://vault.test/v/a', true), { expected: 'null', target: '*' });
});

test('acceptFitMessage: 불투명 출처 틀은 null 출처 + 이 iframe 창만 받는다', () => {
  const frameWin = {};
  const { expected } = fitChannel('/raw/a.html?kv-fit=1', 'http://vault.test/v/a', true);
  const ok = { source: frameWin, origin: 'null', data: { type: FIT_HEIGHT, height: 700 } };
  assert.deepEqual(acceptFitMessage(ok, frameWin, expected), { type: 'height', height: 700 });
  // 다른 창(같은 null 출처의 다른 틀)·이름 출처로 온 것은 버린다.
  assert.equal(acceptFitMessage({ ...ok, source: {} }, frameWin, expected), null);
  assert.equal(acceptFitMessage({ ...ok, origin: 'http://vault.test' }, frameWin, expected), null);
});

test('readArchifyZoom: 기본 100, 단계 값만 읽고 그 밖은 기본', () => {
  assert.equal(withStorage(new Map(), readArchifyZoom), 100);
  assert.equal(withStorage(new Map([[KEY, '130']]), readArchifyZoom), 130);
  assert.equal(withStorage(new Map([[KEY, '120']]), readArchifyZoom), 100);
  assert.equal(withStorage(new Map([[KEY, 'big']]), readArchifyZoom), 100);
  assert.equal(withThrowingStorage(readArchifyZoom), 100);
});

test('writeArchifyZoom: 단계 값은 그대로, 그 밖은 기본으로 적는다', () => {
  const m = new Map<string, string>();
  withStorage(m, () => writeArchifyZoom(150));
  assert.equal(m.get(KEY), '150');
  withStorage(m, () => writeArchifyZoom(999));
  assert.equal(m.get(KEY), '100');
  withThrowingStorage(() => writeArchifyZoom(115)); // 던지지 않는다
});

test('ArchifyFrame: iframe 은 kv-fit 주소, 새 탭 링크는 표지 없는 주소, 높이는 알린 값', () => {
  const src = fs.readFileSync(new URL('../../src/archify/ArchifyFrame.tsx', import.meta.url), 'utf8');
  assert.match(src, /withFitParam\(url\)/);
  assert.match(src, /src=\{fitUrl \?\? url\}/);
  assert.match(src, /<a href=\{url\} target="_blank"/);
  assert.match(src, /useArchifyFit\(frameRef, fitUrl, zoom\)/);
  // ⚙ 설정에 그림 글자 줄이 있다.
  const menu = fs.readFileSync(new URL('../../src/app/SettingsMenu.tsx', import.meta.url), 'utf8');
  assert.match(menu, /<span className="settings-h">그림 글자<\/span>/);
});
