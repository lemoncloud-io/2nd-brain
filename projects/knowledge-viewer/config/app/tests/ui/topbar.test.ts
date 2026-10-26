// 상단바를 SSR 로 그려 아이콘 단추·배지·설정 메뉴 자리를 본다. 넘침을 막는 규칙은 CSS 라 여기서는 구조만 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import type { PrChanges, VaultInfo } from '../../src/app/types.ts';

const { TopBar } = await import('../../src/app/TopBar.tsx');
const { SettingsPanel } = await import('../../src/app/SettingsMenu.tsx');

const info: VaultInfo = {
  name: 'knowledge',
  branch: 'feat/x',
  head: 'abc1234',
  worktree: true,
  dirty: false,
  sources: { main: { available: true, head: 'def5678', fetchedAt: 1 }, local: { available: true, head: 'abc1234' } },
};

const noop = () => {};
const base = {
  path: 'projects/dou/features/dou-subscription-web/README.md',
  agent: false,
  view: 'doc' as const,
  rightOpen: true,
  leftOpen: true,
  onExpand: noop,
  onNavigate: noop,
  onSearchPick: noop,
  onToggleRight: noop,
  onToggleLeft: noop,
  onToggleView: noop,
  src: { kind: 'main' } as const,
  prs: [{ number: 932, title: 'docs(dou)' }],
  mainAvailable: true,
  onSourceChange: noop,
  info,
  head: 'def5678',
  fallbackReason: null,
  changes: null,
  onBadgeClick: noop,
  searchAll: false,
  onSearchAll: noop,
};

test('상단바: 아이콘 단추(트리·지도·북마크·설정·패널)와 검색, 배지가 한 줄에', () => {
  const html = renderToStaticMarkup(createElement(TopBar, base));
  for (const label of ['왼쪽 패널 접기', '연결 지도', '북마크 추가', '설정', '오른쪽 패널 접기']) {
    assert.match(html, new RegExp(`aria-label="${label}"`), label);
  }
  assert.match(html, /class="icon-btn left-toggle"/);
  assert.match(html, /class="icon-btn view-toggle"/);
  assert.match(html, /class="icon-btn settings-toggle"/);
  assert.match(html, /class="icon-btn right-toggle"/);
  assert.match(html, /<svg class="icon"/);
  assert.match(html, /class="search-input"/);
  assert.match(html, /origin\/master @ def5678/);
  // 검색 범위 체크박스는 상단 줄에 없다(⚙ 안에 있다).
  assert.doesNotMatch(html, /search-scope/);
  assert.doesNotMatch(html, /raw·archive 포함/);
  // 메뉴는 닫혀 있다.
  assert.doesNotMatch(html, /role="dialog"/);
});

test('상단바: pr 소스면 PR 배지가 서고 저장소 배지는 빠진다, ▾ 없음', () => {
  const changes: PrChanges = {
    number: 932,
    title: 'docs(dou): 웹 구독 이메일 인증',
    author: 'sunny',
    head: 'docs/x',
    base: 'master',
    headOid: '7ff0c0a6aaaaaaaa',
    updatedAt: '2026-10-23T00:00:00Z',
    url: 'https://github.com/o/r/pull/932',
    baseOid: 'b',
    mergeBase: 'm',
    headCommit: '7ff0c0a6aaaaaaaa',
    files: [],
  };
  const html = renderToStaticMarkup(createElement(TopBar, { ...base, src: { kind: 'pr', number: 932 }, changes }));
  assert.match(html, /class="pr-badge"/);
  assert.match(html, /data-pr="932"/);
  assert.doesNotMatch(html, /vault-badge/);
  assert.doesNotMatch(html, /pr-badge-switch/);
});

test('상단바: 에이전트 모드는 배지만 남고 단추·검색·설정이 없다', () => {
  const html = renderToStaticMarkup(createElement(TopBar, { ...base, agent: true }));
  assert.match(html, /vault-badge/);
  assert.doesNotMatch(html, /icon-btn/);
  assert.doesNotMatch(html, /search-input/);
  assert.doesNotMatch(html, /settings-toggle/);
});

test('설정 메뉴 안: 소스 선택·검색 범위·패널 켜기, 메인 폴백 사유', () => {
  const html = renderToStaticMarkup(
    createElement(SettingsPanel, {
      src: { kind: 'local' },
      prs: [{ number: 932, title: 't' }],
      mainAvailable: false,
      onSourceChange: noop,
      fallbackReason: 'origin 없음',
      searchAll: true,
      onSearchAll: noop,
      leftOpen: true,
      rightOpen: false,
      onToggleLeft: noop,
      onToggleRight: noop,
    }),
  );
  assert.match(html, /role="dialog" aria-label="설정"/);
  assert.match(html, /class="src-select src-select-local"/);
  assert.match(html, /value="main" disabled=""/);
  assert.match(html, /raw·archive 포함/);
  assert.match(html, /메인을 못 열어 로컬로 연다: origin 없음/);
  assert.match(html, /왼쪽 트리/);
  assert.match(html, /오른쪽 패널/);
  // 다이어그램 테마 선택도 ⚙ 안에 있다(패널 설정에서 옮김).
  assert.match(html, /다이어그램 테마/);
  assert.match(html, /class="mermaid-theme-select"/);
});

test('설정 메뉴 안: 패널 켜기·순서 목록은 ⚙ 안에 있고(오른쪽 열에 없음), "켜기·순서…" 를 누르기 전엔 접혀 있다', async () => {
  const { PANELS } = await import('../../src/panels/registry.ts');
  const { loadPrefs } = await import('../../src/panels/prefs.ts');
  const prefs = loadPrefs(PANELS, { getItem: () => null });
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
      panels: PANELS,
      panelPrefs: prefs,
      onPanelPrefs: noop,
    }),
  );
  assert.match(html, /class="settings-link" aria-expanded="false">켜기·순서…</);
  assert.doesNotMatch(html, /panel-settings-list/, '목록은 펼치기 전엔 없다');
  // 압축: 절 제목이 h4 가 아니라 격자의 라벨 칸이고, 밝기는 세 칸 토글, 설명 줄은 없다.
  assert.doesNotMatch(html, /<h4/);
  assert.match(html, /class="seg" role="radiogroup" aria-label="밝기"/);
  assert.doesNotMatch(html, /theme-desc|mermaid-theme-desc/);
  // 패널 목록을 주지 않으면 단추도 없다.
  const bare = renderToStaticMarkup(
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
  assert.doesNotMatch(bare, /켜기·순서…/);
});

test('배지: 짧은 글 + 마우스 오버 카드(볼트·브랜치·커밋·체크아웃·상태), 오른쪽 열엔 패널 설정 단추가 없다', async () => {
  const { badgeRows } = await import('../../src/app/VaultBadge.tsx');
  const html = renderToStaticMarkup(createElement(TopBar, { ...base, src: { kind: 'local' } }));
  assert.match(html, /class="badge-wrap" tabindex="0" aria-label="볼트: knowledge\n브랜치: feat\/x\n커밋: abc1234\n체크아웃: 워크트리\n상태: 깨끗함"/);
  assert.match(html, /<dl class="badge-tip" role="tooltip"><div style="display:contents"><dt>볼트<\/dt><dd class="badge-tip-text">knowledge<\/dd>/);
  assert.doesNotMatch(html, /panel-settings-toggle/);
  const rows = badgeRows({ ...info, dirty: true }, { kind: 'main' }, 'def5678', { now: 1 });
  assert.deepEqual(
    rows.map((r) => `${r.k}=${r.v}`),
    ['볼트=knowledge', '소스=origin/master @ def5678', '가져온 때=방금', '워크트리 브랜치=feat/x', '커밋=abc1234', '체크아웃=워크트리', '상태=수정 중인 파일 있음'],
  );
});
