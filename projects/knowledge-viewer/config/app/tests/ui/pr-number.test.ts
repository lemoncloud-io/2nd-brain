// ⚙ 소스 줄의 PR 번호 칸: 판정(submitPrNumber, 순수)과 칸이 그려지는 조건(SSR).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';

const { submitPrNumber } = await import('../../src/app/pr-number.ts');
const { SettingsPanel } = await import('../../src/app/SettingsMenu.tsx');

/** 부른 기록을 남기는 가짜 묻기·옮기기. */
function sinks(found = true) {
  const calls: string[] = [];
  return {
    calls,
    check: async (n: number) => {
      calls.push(`check ${n}`);
      if (!found) throw new Error('503');
      return {};
    },
    go: (n: number) => {
      calls.push(`go ${n}`);
    },
  };
}

test('submitPrNumber: 번호(123·#123·pr 123)면 묻고 나서 옮긴다', async () => {
  for (const text of ['123', '#123', 'pr 123', ' 123 ']) {
    const s = sinks();
    assert.deepEqual(await submitPrNumber(text, s), { ok: true, number: 123 }, text);
    assert.deepEqual(s.calls, ['check 123', 'go 123'], text);
  }
});

test('submitPrNumber: 번호가 아니면 예시 글, 묻지도 옮기지도 않는다', async () => {
  for (const text of ['abc', '0', '2026-10-27', '#']) {
    const s = sinks();
    assert.deepEqual(await submitPrNumber(text, s), { ok: false, message: '번호를 넣는다 — 예: 123 · #123' }, text);
    assert.deepEqual(s.calls, [], text);
  }
});

test('submitPrNumber: 묻기가 실패하면(없는 번호) 자리에서 알리고 옮기지 않는다', async () => {
  const s = sinks(false);
  assert.deepEqual(await submitPrNumber('999999', s), { ok: false, message: 'PR #999999 을 찾지 못했다' });
  assert.deepEqual(s.calls, ['check 999999']);
});

test('submitPrNumber: 비어 있으면 아무 일도 없다(글도 없다)', async () => {
  for (const text of ['', '   ']) {
    const s = sinks();
    assert.deepEqual(await submitPrNumber(text, s), { ok: false, message: null });
    assert.deepEqual(s.calls, []);
  }
});

const noop = () => {};
const panel = {
  src: { kind: 'main' } as const,
  prs: [{ number: 123, title: 't' }],
  mainAvailable: true,
  onSourceChange: noop,
  fallbackReason: null,
  searchAll: false,
  onSearchAll: noop,
  leftOpen: true,
  rightOpen: true,
  onToggleLeft: noop,
  onToggleRight: noop,
};

test('⚙ 소스 줄: PR 번호 칸은 onEnterPr 가 있을 때만, 선택 상자와 한 줄(src-row)에', () => {
  const html = renderToStaticMarkup(createElement(SettingsPanel, { ...panel, onEnterPr: noop }));
  assert.match(html, /<div class="src-row"><select class="src-select[^"]*"/);
  assert.match(html, /<form class="pr-number"><input class="pr-number-input" inputMode="numeric" placeholder="PR #" aria-label="PR 번호"/);
  assert.match(html, /<button type="submit" class="settings-link">열기<\/button>/);
  // 알림 글은 처음엔 없다.
  assert.doesNotMatch(html, /찾지 못했다|번호를 넣는다/);
  const bare = renderToStaticMarkup(createElement(SettingsPanel, panel));
  assert.match(bare, /class="src-row"/);
  assert.doesNotMatch(bare, /pr-number/);
});
