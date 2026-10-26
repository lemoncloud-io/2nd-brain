// 다이어그램 테마 저장. 기본·저장·모르는 id·막힌 저장소.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MERMAID_THEME_KEY, readMermaidTheme, writeMermaidTheme } from '../../src/reader/mermaid-theme-prefs.ts';
import { DEFAULT_MERMAID_THEME } from '../../src/reader/mermaid-themes/registry.ts';

const memory = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

test('저장소가 없거나 비어 있으면 기본 테마', () => {
  assert.equal(readMermaidTheme(undefined), DEFAULT_MERMAID_THEME);
  assert.equal(readMermaidTheme(memory()), DEFAULT_MERMAID_THEME);
});

test('저장한 id 를 돌려주고 키는 knowledge-viewer.mermaid-theme 다', () => {
  const s = memory();
  writeMermaidTheme('mono', s);
  assert.equal(s.m.get(MERMAID_THEME_KEY), 'mono');
  assert.equal(readMermaidTheme(s), 'mono');
  writeMermaidTheme('classic', s);
  assert.equal(readMermaidTheme(s), 'classic');
});

test('모르는 id 는 읽을 때도 쓸 때도 기본으로', () => {
  const s = memory();
  s.m.set(MERMAID_THEME_KEY, 'no-such-theme');
  assert.equal(readMermaidTheme(s), DEFAULT_MERMAID_THEME);
  writeMermaidTheme('also-unknown', s);
  assert.equal(s.m.get(MERMAID_THEME_KEY), DEFAULT_MERMAID_THEME);
});

test('저장소가 던져도 기본으로 살고 쓰기도 던지지 않는다', () => {
  const broken = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  assert.equal(readMermaidTheme(broken), DEFAULT_MERMAID_THEME);
  assert.doesNotThrow(() => writeMermaidTheme('mono', broken));
});
