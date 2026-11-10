// archify 틀 맞춤 약속(shared/archify-fit.ts) — 쿼리 표지, 높이 묶기, 메시지 꼴, 배율 단계.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ARCHIFY_FRAME_MAX_HEIGHT,
  ARCHIFY_FRAME_MIN_HEIGHT,
  ARCHIFY_ZOOM_STEPS,
  FIT_HEIGHT,
  FIT_READY,
  FIT_SETTINGS,
  fitFrameHeight,
  fitSettingsMessage,
  isArchifyZoom,
  parseFitMessage,
  wantsArchifyFit,
  withFitParam,
} from '../../shared/archify-fit.ts';

test('wantsArchifyFit: kv-fit=1 일 때만 참', () => {
  assert.equal(wantsArchifyFit('?kv-fit=1'), true);
  assert.equal(wantsArchifyFit('?theme=dark&kv-fit=1'), true);
  assert.equal(wantsArchifyFit(''), false);
  assert.equal(wantsArchifyFit('?kv-fit=0'), false);
  assert.equal(wantsArchifyFit('?kv-fit=true'), false);
  assert.equal(wantsArchifyFit('?kv-fitx=1'), false);
});

test('fitFrameHeight: 올림하고 최소·최대로 묶는다, 수가 아니면 null', () => {
  assert.equal(ARCHIFY_FRAME_MIN_HEIGHT, 480);
  assert.equal(fitFrameHeight(10), ARCHIFY_FRAME_MIN_HEIGHT);
  assert.equal(fitFrameHeight(0), ARCHIFY_FRAME_MIN_HEIGHT);
  assert.equal(fitFrameHeight(1234.2), 1235);
  assert.equal(fitFrameHeight(10 ** 9), ARCHIFY_FRAME_MAX_HEIGHT);
  assert.equal(fitFrameHeight(Number.NaN), null);
  assert.equal(fitFrameHeight(Number.POSITIVE_INFINITY), null);
  assert.equal(fitFrameHeight('900'), null);
});

test('parseFitMessage: ready·height 꼴만 받는다', () => {
  assert.deepEqual(parseFitMessage({ type: FIT_READY }), { type: 'ready' });
  assert.deepEqual(parseFitMessage({ type: FIT_HEIGHT, height: 812 }), { type: 'height', height: 812 });
  for (const bad of [
    null,
    'kv-archify:ready',
    [FIT_READY],
    { type: FIT_HEIGHT },
    { type: FIT_HEIGHT, height: '812' },
    { type: FIT_HEIGHT, height: -1 },
    { type: FIT_HEIGHT, height: Number.NaN },
    { type: FIT_SETTINGS, zoom: 100 },
    { type: 'other', height: 1 },
  ]) {
    assert.equal(parseFitMessage(bad), null, JSON.stringify(bad));
  }
});

test('배율 단계: 100·115·130·150, 기본 100, 설정 메시지 꼴', () => {
  assert.deepEqual([...ARCHIFY_ZOOM_STEPS], [100, 115, 130, 150]);
  assert.equal(isArchifyZoom(130), true);
  assert.equal(isArchifyZoom(120), false);
  assert.equal(isArchifyZoom('130'), false);
  assert.deepEqual(fitSettingsMessage(150), { type: FIT_SETTINGS, zoom: 150 });
});

test('withFitParam: 쿼리 뒤에 kv-fit=1, hash 는 끝에 둔다', () => {
  assert.equal(withFitParam('http://localhost:1/raw/a.html?theme=dark#focus=x'), 'http://localhost:1/raw/a.html?theme=dark&kv-fit=1#focus=x');
  assert.equal(withFitParam('/raw/a.html'), '/raw/a.html?kv-fit=1');
  assert.equal(withFitParam('/raw/a.html#r'), '/raw/a.html?kv-fit=1#r');
});
