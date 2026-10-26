// 단축키 순수 모듈: 표기(맥/윈도)·매칭(mod 매핑·Shift·? 기호·한글 자판)·입력 중 제외·표의 중복·브라우저 예약 조합.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BROWSER_RESERVED,
  SHORTCUTS,
  allowedWhileTyping,
  findShortcut,
  formatKeys,
  isMac,
  isTypingTarget,
  keysFor,
  matchShortcut,
  parseCombo,
  type KeyEventLike,
  type Platform,
} from '../../src/app/shortcuts.ts';
import { stepIndex } from '../../src/app/tree-nav.ts';
import { parseShortcutPlatform } from '../../src/app/prefs/shortcuts.ts';

const ev = (key: string, mods: Partial<Omit<KeyEventLike, 'key'>> = {}): KeyEventLike => ({
  key,
  code: mods.code,
  ctrlKey: mods.ctrlKey ?? false,
  metaKey: mods.metaKey ?? false,
  altKey: mods.altKey ?? false,
  shiftKey: mods.shiftKey ?? false,
});

test('formatKeys: 맥은 기호를 붙여 쓰고(⌃⌥⇧⌘ 순), 윈도는 Ctrl+Shift+ 로 잇는다', () => {
  assert.equal(formatKeys('mod+k', 'mac'), '⌘K');
  assert.equal(formatKeys('mod+k', 'win'), 'Ctrl+K');
  assert.equal(formatKeys('mod+shift+f', 'mac'), '⇧⌘F');
  assert.equal(formatKeys('mod+shift+f', 'win'), 'Ctrl+Shift+F');
  assert.equal(formatKeys('alt+arrowleft', 'mac'), '⌥←');
  assert.equal(formatKeys('alt+arrowleft', 'win'), 'Alt+←');
  assert.equal(formatKeys('ctrl+alt+shift+mod+x', 'mac'), '⌃⌥⇧⌘X');
  assert.equal(formatKeys('mod+[', 'mac'), '⌘[');
  // 수식어 없는 글자는 소문자, 기호·이름 키는 그대로.
  assert.equal(formatKeys('g', 'mac'), 'g');
  assert.equal(formatKeys('?', 'win'), '?');
  assert.equal(formatKeys('escape', 'mac'), 'Esc');
  assert.equal(formatKeys('shift', 'mac'), '⇧');
  assert.equal(formatKeys('shift', 'win'), 'Shift');
  assert.equal(formatKeys('space', 'win'), 'Space');
});

test('isMac: userAgentData·platform·userAgent', () => {
  assert.equal(isMac({ platform: 'MacIntel' }), true);
  assert.equal(isMac({ platform: 'Win32' }), false);
  assert.equal(isMac({ platform: 'Linux x86_64' }), false);
  assert.equal(isMac({ userAgentData: { platform: 'macOS' }, platform: 'Win32' }), true);
  assert.equal(isMac({ userAgentData: { platform: 'Windows' } }), false);
  assert.equal(isMac({ platform: '', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }), true);
  assert.equal(isMac(undefined), false);
});

test('matchShortcut: mod 는 맥 ⌘ / 윈도 Ctrl, 반대 키는 아니다', () => {
  assert.equal(matchShortcut(ev('k', { metaKey: true }), 'mod+k', 'mac'), true);
  assert.equal(matchShortcut(ev('k', { ctrlKey: true }), 'mod+k', 'mac'), false);
  assert.equal(matchShortcut(ev('k', { ctrlKey: true }), 'mod+k', 'win'), true);
  assert.equal(matchShortcut(ev('k', { metaKey: true }), 'mod+k', 'win'), false);
  assert.equal(matchShortcut(ev('k'), 'mod+k', 'mac'), false);
});

test('matchShortcut: Shift 유무는 정확히 맞아야 한다', () => {
  assert.equal(matchShortcut(ev('f', { metaKey: true, shiftKey: true }), 'mod+shift+f', 'mac'), true);
  assert.equal(matchShortcut(ev('F', { ctrlKey: true, shiftKey: true }), 'mod+shift+f', 'win'), true);
  assert.equal(matchShortcut(ev('f', { metaKey: true }), 'mod+shift+f', 'mac'), false);
  assert.equal(matchShortcut(ev('k', { metaKey: true, shiftKey: true }), 'mod+k', 'mac'), false);
  assert.equal(matchShortcut(ev('G', { shiftKey: true }), 'g', 'mac'), false);
  assert.equal(matchShortcut(ev('g'), 'g', 'mac'), true);
  // 다른 수식어가 붙으면 글자 단축키가 아니다(⌘G 는 브라우저의 "다음 찾기").
  assert.equal(matchShortcut(ev('g', { metaKey: true }), 'g', 'mac'), false);
  assert.equal(matchShortcut(ev('g', { altKey: true, code: 'KeyG' }), 'g', 'mac'), false);
});

test('matchShortcut: ? 는 Shift+/ 로 들어온다 — Shift 가 눌린 채여도, 자판이 / 를 보내도 맞는다', () => {
  for (const p of ['mac', 'win'] as Platform[]) {
    assert.equal(matchShortcut(ev('?', { shiftKey: true, code: 'Slash' }), '?', p), true);
    assert.equal(matchShortcut(ev('?', { shiftKey: false }), '?', p), true);
    // 한글 입력기 등이 key 를 ASCII 로 주지 않을 때 물리 키 Shift+Slash.
    assert.equal(matchShortcut(ev('Process', { shiftKey: true, code: 'Slash' }), '?', p), true);
    // key 가 '/' 인 채 Shift 가 눌려 오는 자판·자동화.
    assert.equal(matchShortcut(ev('/', { shiftKey: true, code: 'Slash' }), '?', p), true);
    assert.equal(matchShortcut(ev('/', { code: 'Slash' }), '?', p), false);
    assert.equal(matchShortcut(ev('/', { code: 'Slash' }), '/', p), true);
    assert.equal(matchShortcut(ev('?', { shiftKey: true }), '/', p), false);
  }
});

test('matchShortcut: 한글 자판(ㅎ)·맥 ⌥ 글자는 물리 키로 맞춘다, ASCII 는 글자 그대로', () => {
  assert.equal(matchShortcut(ev('ㅎ', { code: 'KeyG' }), 'g', 'mac'), true);
  assert.equal(matchShortcut(ev('ㅠ', { code: 'KeyB' }), 'b', 'win'), true);
  assert.equal(matchShortcut(ev('“', { metaKey: false, altKey: true, code: 'BracketLeft' }), 'alt+[', 'mac'), true);
  // 드보락: 물리 KeyG 자리에서 'i' 가 오면 g 가 아니다.
  assert.equal(matchShortcut(ev('i', { code: 'KeyG' }), 'g', 'mac'), false);
  assert.equal(matchShortcut(ev('['), '[', 'win'), true);
  assert.equal(matchShortcut(ev('Escape'), 'escape', 'mac'), true);
  assert.equal(matchShortcut(ev('ArrowDown'), 'arrowdown', 'win'), true);
  assert.equal(matchShortcut(ev('ArrowLeft', { altKey: true }), 'alt+arrowleft', 'win'), true);
});

test('isTypingTarget: input·textarea·select·contenteditable 은 입력, 나머지는 아니다', () => {
  assert.equal(isTypingTarget({ tagName: 'INPUT' }), true);
  assert.equal(isTypingTarget({ tagName: 'input' }), true);
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTypingTarget({ tagName: 'SELECT' }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV' }), false);
  assert.equal(isTypingTarget({ tagName: 'A' }), false);
  assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isTypingTarget(null), false);
});

test('입력 중에는 Esc 와 수식어 조합만 받는다 — g·/·? 는 글자다', () => {
  assert.equal(allowedWhileTyping('escape'), true);
  assert.equal(allowedWhileTyping('mod+k'), true);
  assert.equal(allowedWhileTyping('mod+shift+f'), true);
  assert.equal(allowedWhileTyping('g'), false);
  assert.equal(allowedWhileTyping('/'), false);
  assert.equal(allowedWhileTyping('?'), false);
  for (const p of ['mac', 'win'] as Platform[]) {
    assert.equal(findShortcut(ev('g'), p, true), null);
    assert.equal(findShortcut(ev('/'), p, true), null);
    assert.equal(findShortcut(ev('?', { shiftKey: true }), p, true), null);
    assert.deepEqual(findShortcut(ev('Escape'), p, true), { id: 'escape', combo: 'escape' });
    const mod = p === 'mac' ? { metaKey: true } : { ctrlKey: true };
    assert.deepEqual(findShortcut(ev('k', mod), p, true), { id: 'search.focus', combo: 'mod+k' });
    // 입력 밖에서는 글자 단축키가 듣는다.
    assert.deepEqual(findShortcut(ev('g'), p, false), { id: 'view.graph', combo: 'g' });
    assert.deepEqual(findShortcut(ev('?', { shiftKey: true }), p, false), { id: 'help', combo: '?' });
  }
});

test('단축키 표: id 는 겹치지 않고, app 조합은 플랫폼마다 한 동작에만 걸린다', () => {
  const ids = SHORTCUTS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, '같은 id');
  for (const p of ['mac', 'win'] as Platform[]) {
    const seen = new Map<string, string>();
    for (const s of SHORTCUTS.filter((x) => x.scope === 'app')) {
      for (const combo of keysFor(s, p)) {
        const c = parseCombo(combo);
        const norm = JSON.stringify(c);
        assert.ok(!seen.has(norm), `${p}: ${combo} 가 ${seen.get(norm)} 와 ${s.id} 에 겹친다`);
        seen.set(norm, s.id);
      }
    }
  }
});

test('단축키 표: 앱이 잡는 조합에 브라우저 예약 조합(⌘W·T·L·R·P·N 등)이 없다', () => {
  const reserved = new Set(BROWSER_RESERVED.map((c) => JSON.stringify(parseCombo(c))));
  for (const must of ['mod+w', 'mod+t', 'mod+l', 'mod+r', 'mod+p', 'mod+n']) assert.ok(reserved.has(JSON.stringify(parseCombo(must))), must);
  for (const p of ['mac', 'win'] as Platform[]) {
    for (const s of SHORTCUTS.filter((x) => x.scope === 'app')) {
      for (const combo of keysFor(s, p)) {
        assert.ok(!reserved.has(JSON.stringify(parseCombo(combo))), `${s.id}: ${combo} 는 브라우저 예약`);
        // mod 대신 ctrl·meta 로 적어도 같은 키는 안 된다.
        const c = parseCombo(combo);
        if (c.ctrl || c.meta) assert.ok(!reserved.has(JSON.stringify({ ...c, mod: true, ctrl: false, meta: false })), combo);
      }
    }
  }
});

test('단축키 표: 모든 그룹에 항목이 있고, 그래프 그룹은 지도의 Shift·Space·호버를 적는다', () => {
  for (const g of ['nav', 'search', 'panel', 'doc', 'graph']) assert.ok(SHORTCUTS.some((s) => s.group === g), g);
  const graph = SHORTCUTS.filter((s) => s.group === 'graph');
  assert.deepEqual(
    graph.map((s) => s.keys[0]),
    ['shift', 'space', 'hover'],
  );
  assert.ok(graph.every((s) => s.scope === 'graph'), '그래프 키는 지도 캔버스가 처리한다 — 전역 훅이 잡지 않는다');
  // 전역 훅은 Space·Shift 단독을 잡지 않는다(지도와 충돌하지 않게).
  for (const p of ['mac', 'win'] as Platform[]) {
    assert.equal(findShortcut(ev(' '), p, false), null);
    assert.equal(findShortcut(ev('Shift', { shiftKey: true }), p, false), null);
  }
});

test('뒤로·앞으로는 브라우저 기본 키를 적기만 한다 — 맥 ⌘[ ⌘], 윈도 Alt+←→', () => {
  const back = SHORTCUTS.find((s) => s.id === 'history.back')!;
  assert.equal(back.scope, 'native');
  assert.deepEqual(keysFor(back, 'mac'), ['mod+[']);
  assert.deepEqual(keysFor(back, 'win'), ['alt+arrowleft']);
});

test('트리 이동 위치: 끝에서 멈추고, 포커스가 없으면 처음·끝', () => {
  assert.equal(stepIndex(5, 2, 1), 3);
  assert.equal(stepIndex(5, 4, 1), 4);
  assert.equal(stepIndex(5, 0, -1), 0);
  assert.equal(stepIndex(5, -1, 1), 0);
  assert.equal(stepIndex(5, -1, -1), 4);
  assert.equal(stepIndex(0, -1, 1), -1);
});

test('표기 플랫폼 설정: 모르는 값은 자동', () => {
  assert.equal(parseShortcutPlatform('mac'), 'mac');
  assert.equal(parseShortcutPlatform('win'), 'win');
  assert.equal(parseShortcutPlatform('linux'), 'auto');
  assert.equal(parseShortcutPlatform(null), 'auto');
});
