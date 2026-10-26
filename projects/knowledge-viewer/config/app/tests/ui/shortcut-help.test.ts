// 도움말 오버레이를 SSR 로 그려 모든 그룹·모든 단축키·플랫폼 표기·표기 전환 토글을 본다. ⚙ 메뉴의 도움말 항목도 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import { GROUPS, SHORTCUTS, formatKeys, keysFor } from '../../src/app/shortcuts.ts';

const { ShortcutHelp } = await import('../../src/app/ShortcutHelp.tsx');
const { SettingsPanel } = await import('../../src/app/SettingsMenu.tsx');

const noop = () => {};
const render = (platform: 'mac' | 'win', choice: 'auto' | 'mac' | 'win' = 'auto', detected: 'mac' | 'win' = platform) =>
  renderToStaticMarkup(createElement(ShortcutHelp, { platform, choice, detected, onChoice: noop, onClose: noop }));

/** 키캡 글을 이어 붙인 조합 표기(윈도는 + 구분자가 따로 그려진다). */
const kbdText = (html: string, combo: string): string => {
  const m = html.match(new RegExp(`data-combo="${combo.replace(/[[\]?+]/g, (c) => `\\${c}`)}">(.*?)</span></span>(?:</span>|<span class="kbd-or">|</td>)`));
  assert.ok(m, `조합 없음: ${combo}`);
  return [...m[1]!.matchAll(/<kbd class="kbd">([^<]*)<\/kbd>|<span class="kbd-plus">\+<\/span>/g)].map((x) => (x[1] === undefined ? '+' : x[1])).join('');
};

test('도움말: 대화 상자이고 다섯 그룹(탐색·검색·패널·문서·그래프)을 순서대로 그린다', () => {
  const html = render('mac');
  assert.match(html, /role="dialog" aria-modal="true" aria-label="단축키 도움말"/);
  const order = [...html.matchAll(/data-group="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, GROUPS.map((g) => g.id));
  for (const g of GROUPS) assert.ok(html.includes(`>${g.label}</h3>`), g.label);
});

test('도움말: 표의 모든 단축키가 한 행씩, 설명과 함께', () => {
  const html = render('win');
  const rows = [...html.matchAll(/data-shortcut="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(rows.sort(), SHORTCUTS.map((s) => s.id).sort());
  for (const s of SHORTCUTS) assert.ok(html.includes(s.desc), s.id);
});

test('도움말: 맥 표기는 ⌘·⇧, 윈도 표기는 Ctrl+Shift+ — 모든 조합이 formatKeys 와 같다', () => {
  for (const p of ['mac', 'win'] as const) {
    const html = render(p);
    for (const s of SHORTCUTS) for (const combo of keysFor(s, p)) assert.equal(kbdText(html, combo), formatKeys(combo, p), `${p} ${combo}`);
  }
  const mac = render('mac');
  assert.ok(mac.includes('<kbd class="kbd">⌘</kbd><kbd class="kbd">K</kbd>') || mac.includes('<kbd class="kbd">⌘</kbd></span><span><kbd class="kbd">K</kbd>'));
  assert.doesNotMatch(mac, /Ctrl/);
  const win = render('win');
  assert.match(win, /<kbd class="kbd">Ctrl<\/kbd>/);
  assert.doesNotMatch(win, /⌘/);
  // 뒤로 가기는 플랫폼마다 다른 브라우저 키다.
  assert.match(mac, /data-combo="mod\+\["/);
  assert.match(win, /data-combo="alt\+arrowleft"/);
});

test('도움말: 표기 전환 토글(자동·맥·윈도) — 자동이 기본이고 판정 플랫폼을 보인다', () => {
  const html = render('mac', 'auto', 'mac');
  assert.match(html, /role="radiogroup" aria-label="표기"/);
  assert.match(html, /aria-checked="true"[^>]*>자동\(맥\)</);
  assert.match(html, /aria-checked="false"[^>]*>맥</);
  assert.match(html, /aria-checked="false"[^>]*>윈도</);
  // 강제로 윈도 표기: 토글은 윈도, 안내는 실제 키가 맥이라고 알린다.
  const forced = render('win', 'win', 'mac');
  assert.match(forced, /aria-checked="true"[^>]*>윈도</);
  assert.match(forced, /이 브라우저는 맥 키로 듣는다/);
  assert.match(forced, /aria-label="닫기"/);
});

test('⚙ 설정 메뉴에 "단축키 도움말" 항목이 있다', () => {
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
  assert.match(html, /class="settings-help"[^>]*><span>단축키 도움말<\/span><kbd class="kbd">\?<\/kbd>/);
});
