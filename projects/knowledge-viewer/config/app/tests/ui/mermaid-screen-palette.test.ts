// 다이어그램 vault 테마가 화면 테마의 색을 따르는지: 토큰 읽기(screenPaletteFrom)와 init(dark, screen).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findMermaidTheme } from '../../src/reader/mermaid-themes/registry.ts';
import { SCREEN_PALETTE_VARS, screenPaletteFrom } from '../../src/reader/mermaid-themes/types.ts';

const vars: Record<string, string> = Object.fromEntries(Object.values(SCREEN_PALETTE_VARS).map((v, i) => [v, ` #${(0x101010 + i).toString(16)} `]));

test('screenPaletteFrom: 변수 값을 다듬어 담고, 하나라도 hex 가 아니면 null', () => {
  const p = screenPaletteFrom((v) => vars[v] ?? '');
  assert.ok(p !== null);
  assert.equal(p.bg, '#101010');
  assert.equal(Object.keys(p).length, Object.keys(SCREEN_PALETTE_VARS).length);
  assert.equal(screenPaletteFrom((v) => (v === '--accent' ? 'rgb(1 2 3)' : (vars[v] ?? ''))), null);
  assert.equal(screenPaletteFrom(() => ''), null);
});

test('vault 다이어그램은 화면 팔레트를 주면 그 색으로, 안 주면 내장 색으로 그린다', () => {
  const vault = findMermaidTheme('vault');
  const p = screenPaletteFrom((v) => vars[v] ?? '')!;
  const custom = vault.init(true, p).themeVariables as Record<string, unknown>;
  const builtin = vault.init(true).themeVariables as Record<string, unknown>;
  assert.equal(custom['background'], p.bg);
  assert.equal(custom['primaryBorderColor'], p.accent);
  assert.equal(custom['noteBkgColor'], p.amberBg);
  assert.notEqual(builtin['background'], p.bg);
  assert.equal(builtin['background'], '#12171d');
});

test('classic·mono 는 화면 팔레트를 무시한다', () => {
  const p = screenPaletteFrom((v) => vars[v] ?? '')!;
  for (const id of ['classic', 'mono']) {
    const t = findMermaidTheme(id);
    assert.deepEqual(t.init(true, p), t.init(true));
  }
});
