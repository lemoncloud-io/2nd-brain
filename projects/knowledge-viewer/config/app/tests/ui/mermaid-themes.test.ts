// Mermaid 테마 등록부. id 유일·기본 존재·init 이 라이트/다크 둘 다 유효한 설정을 준다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_MERMAID_THEME, findMermaidTheme, MERMAID_THEMES } from '../../src/reader/mermaid-themes/registry.ts';

test('id 는 유일하고 비어 있지 않다', () => {
  const ids = MERMAID_THEMES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id !== ''));
  assert.deepEqual(ids, ['vault', 'classic', 'mono']);
});

test('기본 테마가 등록부에 있고 모르는 id 는 기본으로 간다', () => {
  assert.equal(findMermaidTheme(DEFAULT_MERMAID_THEME).id, DEFAULT_MERMAID_THEME);
  assert.equal(findMermaidTheme('no-such-theme').id, DEFAULT_MERMAID_THEME);
  assert.equal(findMermaidTheme(null).id, DEFAULT_MERMAID_THEME);
  assert.equal(findMermaidTheme(undefined).id, DEFAULT_MERMAID_THEME);
  assert.equal(findMermaidTheme('mono').id, 'mono');
});

test('init 은 dark/light 둘 다 theme 를 가진 객체를 준다', () => {
  for (const t of MERMAID_THEMES) {
    for (const dark of [false, true]) {
      const cfg = t.init(dark);
      assert.equal(typeof cfg, 'object', `${t.id} ${dark}`);
      assert.equal(typeof cfg.theme, 'string', `${t.id} ${dark} theme`);
      // startOnLoad·securityLevel 은 Mermaid.tsx 몫이다 — 테마가 정하면 안 된다.
      assert.equal(cfg.startOnLoad, undefined, `${t.id} startOnLoad`);
      assert.equal(cfg.securityLevel, undefined, `${t.id} securityLevel`);
    }
    assert.ok(t.title !== '' && t.description !== '', `${t.id} title/description`);
  }
});

test('classic 은 mermaid 기본 테마 그대로(라이트 default · 다크 dark)', () => {
  const c = findMermaidTheme('classic');
  assert.equal(c.init(false).theme, 'default');
  assert.equal(c.init(true).theme, 'dark');
  assert.equal(c.init(true).themeVariables, undefined);
});

test('vault 는 base 테마에 변수·글꼴을 주고 다크에서 색이 바뀐다', () => {
  const v = findMermaidTheme('vault');
  const light = v.init(false);
  const dark = v.init(true);
  assert.equal(light.theme, 'base');
  const lv = light.themeVariables as Record<string, unknown>;
  const dv = dark.themeVariables as Record<string, unknown>;
  assert.equal(typeof lv['fontFamily'], 'string');
  assert.equal(lv['darkMode'], false);
  assert.equal(dv['darkMode'], true);
  assert.notEqual(lv['primaryColor'], dv['primaryColor']);
  assert.notEqual(lv['lineColor'], dv['lineColor']);
  // 색은 16진수 리터럴이다(CSS 변수는 mermaid 가 파생색을 못 만든다).
  for (const vars of [lv, dv]) {
    for (const [k, val] of Object.entries(vars)) {
      if (/Color$|Bkg$|Background$|Border$|^background$|^mainBkg$|^nodeBkg$|^clusterBkg$|^stateBkg$|^actorBkg$/.test(k)) {
        assert.match(String(val), /^#[0-9a-f]{6}$/i, `${k}=${String(val)}`);
      }
    }
  }
  assert.equal(typeof light.themeCSS, 'string');
});

test('mono 는 화면 테마와 무관하게 흰 바탕·검은 선이고 그릇 CSS 는 자기 id 로 묶는다', () => {
  const m = findMermaidTheme('mono');
  const a = m.init(false).themeVariables as Record<string, unknown>;
  const b = m.init(true).themeVariables as Record<string, unknown>;
  assert.deepEqual(a, b);
  assert.equal(a['lineColor'], '#000000');
  assert.equal(a['mainBkg'], '#ffffff');
  assert.ok(m.css !== undefined && m.css.includes('.mermaid[data-mermaid-theme="mono"]'));
});
