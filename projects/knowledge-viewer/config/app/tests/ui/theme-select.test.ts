// 화면 테마 고르기(ThemeSelect)를 SSR 로 그려 옵션·밝기 라디오·⚙ 메뉴 자리를 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import { THEMES } from '../../src/app/themes.ts';

const { ThemeSelect } = await import('../../src/app/ThemeSelect.tsx');
const { SettingsPanel } = await import('../../src/app/SettingsMenu.tsx');

const options = (html: string) => [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
/** 체크된 라디오의 value. React 는 checked 를 value 앞에 적는다 — 순서에 기대지 않는다. */
const checked = (html: string) => [...html.matchAll(/<input [^>]*type="radio"[^>]*>/g)].map((m) => m[0]).filter((t) => / checked=/.test(t)).map((t) => /value="([^"]+)"/.exec(t)![1]);

test('옵션은 등록부 순서 그대로, 기본 선택은 vault·자동이고 출처 링크가 없다', () => {
  const html = renderToStaticMarkup(createElement(ThemeSelect));
  assert.deepEqual(
    options(html),
    THEMES.map((t) => t.id),
  );
  assert.match(html, /<option value="vault" selected/);
  assert.deepEqual(checked(html), ['auto']);
  assert.ok(html.includes('자동') && html.includes('라이트') && html.includes('다크'));
  assert.ok(!html.includes('출처'));
});

test('value 를 주면 그 테마·밝기가 선택되고 변형 이름과 출처 링크가 보인다', () => {
  const html = renderToStaticMarkup(createElement(ThemeSelect, { value: { theme: 'catppuccin', scheme: 'dark' }, onTheme: () => {}, onScheme: () => {} }));
  assert.match(html, /<option value="catppuccin" selected/);
  assert.deepEqual(checked(html), ['dark']);
  assert.ok(html.includes('Latte · Mocha'));
  assert.ok(html.includes('href="https://github.com/catppuccin/catppuccin"'));
  assert.ok(html.includes('rel="noreferrer noopener"'));
});

test('⚙ 설정 메뉴에 "테마" 절이 다이어그램 절보다 먼저 있다', () => {
  const noop = () => {};
  const html = renderToStaticMarkup(
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
    }),
  );
  // 압축 격자라 절 제목은 <span class="settings-h"> 다.
  const theme = html.indexOf('settings-h">테마</span>');
  const diagram = html.indexOf('settings-h">다이어그램</span>');
  assert.ok(theme > 0 && diagram > theme, `테마 ${theme}, 다이어그램 ${diagram}`);
  assert.ok(html.includes('theme-select'));
});
