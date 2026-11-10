import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../helpers/tsx-hooks.ts';
import { clearViewerError, createViewerError, describeError, errorDetails, getViewerError, installGlobalErrorHandlers,
  reportViewerError, subscribeViewerError } from '../../src/app/errors.ts';

const { ErrorScreen } = await import('../../src/app/ErrorScreen.tsx');

test('오류 설명: Error·문자열·이유 없는 rejection·순환 객체를 안전하게 문자열로 바꾼다', () => {
  assert.equal(describeError(new TypeError('잘못된 경로')).message, 'TypeError: 잘못된 경로');
  assert.match(describeError(new Error('stack')).stack, /errors\.test\.ts/);
  assert.equal(describeError('원문').message, '원문');
  assert.match(describeError(undefined).message, /이유가 제공되지/);
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
  assert.equal(describeError(cyclic).message, '[object Object]');
  const hostile = { toString() { throw new Error('no'); } }; Object.assign(hostile, { self: hostile });
  assert.match(describeError(hostile).message, /변환할 수 없습니다/);
  assert.ok(describeError('x'.repeat(100_000)).message.length < 21_000);
});

test('전역 핸들러: error와 unhandledrejection을 구독자에게 알리고 최초 원인과 기본 콘솔 동작을 보존한다', (t) => {
  clearViewerError();
  const target = new EventTarget();
  const stop = installGlobalErrorHandlers(target);
  let calls = 0;
  const unsubscribe = subscribeViewerError(() => calls++);
  t.after(() => { unsubscribe(); stop(); clearViewerError(); });
  const runtime = Object.assign(new Event('error', { cancelable: true }), { error: new Error('첫 원인') });
  target.dispatchEvent(runtime);
  assert.equal(getViewerError()?.kind, 'runtime');
  assert.match(getViewerError()!.message, /첫 원인/);
  assert.equal(runtime.defaultPrevented, false);
  target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: '뒤따른 오류' }));
  assert.match(getViewerError()!.message, /첫 원인/);
  assert.equal(calls, 1);
  clearViewerError();
  const rejection = Object.assign(new Event('unhandledrejection', { cancelable: true }), { reason: { message: '거절됨' } });
  target.dispatchEvent(rejection);
  assert.equal(getViewerError()?.kind, 'promise');
  assert.equal(getViewerError()?.message, '거절됨');
  assert.equal(rejection.defaultPrevented, false);
  stop(); clearViewerError();
  target.dispatchEvent(runtime);
  assert.equal(getViewerError(), null);
});

test('전역 핸들러: 리소스 오류는 무시하고 Error 객체 없는 스크립트 오류에는 파일·줄을 남긴다', (t) => {
  clearViewerError();
  const target = new EventTarget();
  const stop = installGlobalErrorHandlers(target);
  t.after(() => { stop(); clearViewerError(); });
  target.dispatchEvent(new Event('error'));
  assert.equal(getViewerError(), null);
  target.dispatchEvent(Object.assign(new Event('error'), { message: 'Script error', filename: '/assets/app.js', lineno: 9, colno: 3 }));
  assert.equal(getViewerError()?.stack, '/assets/app.js:9:3');
});

test('오류 화면: 메시지·상세 스택·복구 동작을 렌더하고 오류 문자열을 HTML로 실행하지 않는다', () => {
  const error = { ...createViewerError(new Error('<script>bad()</script>'), 'render'), location: '/v/wiki/INDEX.md?src=pr:1118', componentStack: '\n at Reader' };
  const html = renderToStaticMarkup(createElement(ErrorScreen, { error, onRetry() {} }));
  assert.match(html, /role="alert"/);
  assert.match(html, /다시 시도/);
  assert.match(html, /새로고침/);
  assert.match(html, /오류 내용 복사/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.equal(html.includes('<script>'), false);
  assert.match(errorDetails(error), /src=pr:1118/);
  assert.match(errorDetails(error), /at Reader/);
});

test('오류 저장소: 구독 해제와 복구 이후에는 다음 오류를 받을 수 있다', () => {
  clearViewerError();
  let calls = 0;
  const stop = subscribeViewerError(() => calls++);
  reportViewerError('실패', 'promise');
  clearViewerError();
  stop();
  reportViewerError('다음 실패', 'runtime');
  assert.equal(calls, 2);
  assert.equal(getViewerError()?.message, '다음 실패');
  clearViewerError();
});
