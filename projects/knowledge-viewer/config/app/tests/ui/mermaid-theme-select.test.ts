// 테마 선택 상자를 SSR 로 그려 옵션 수·선택값·설명을 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import { DEFAULT_MERMAID_THEME, MERMAID_THEMES } from '../../src/reader/mermaid-themes/registry.ts';

const { MermaidThemeSelect } = await import('../../src/reader/MermaidThemeSelect.tsx');

const options = (html: string) => [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);

test('옵션은 등록부 순서·수 그대로이고 기본 선택은 기본 테마', () => {
  const html = renderToStaticMarkup(createElement(MermaidThemeSelect));
  assert.deepEqual(
    options(html),
    MERMAID_THEMES.map((t) => t.id),
  );
  assert.ok(html.includes('다이어그램 테마'));
  // SSR 의 select 는 selected 속성으로 값을 적는다.
  assert.match(html, new RegExp(`<option value="${DEFAULT_MERMAID_THEME}" selected`));
  assert.ok(html.includes(MERMAID_THEMES[0]!.description));
});

test('value 를 주면 그 테마가 선택되고 설명도 그 테마 것이다', () => {
  const html = renderToStaticMarkup(createElement(MermaidThemeSelect, { value: 'mono', onChange: () => undefined }));
  assert.match(html, /<option value="mono" selected/);
  assert.ok(html.includes(MERMAID_THEMES.find((t) => t.id === 'mono')!.description));
});

test('모르는 value 는 기본 테마로 그린다', () => {
  const html = renderToStaticMarkup(createElement(MermaidThemeSelect, { value: 'nope' }));
  assert.match(html, new RegExp(`<option value="${DEFAULT_MERMAID_THEME}" selected`));
});
