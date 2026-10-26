// PR 상세 패널·PR 배지를 SSR 로 그려 링크·취소선·현재 행·오류 문구를 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import type { DocChange, PrChanges } from '../../src/app/types.ts';

const { PrDetailPanel } = await import('../../src/panels/PrDetailPanel.tsx');
const { PrBadge } = await import('../../src/app/PrBadge.tsx');
const { VaultBadge } = await import('../../src/app/VaultBadge.tsx');

const SRC = { kind: 'pr', number: 927 } as const;
const changes: PrChanges = {
  number: 927,
  title: 'PR 리뷰 모드',
  author: 'steve',
  head: 'feat/x',
  base: 'master',
  headOid: '0123456789abcdef',
  updatedAt: '2026-10-23T00:00:00Z',
  url: 'https://github.com/o/r/pull/927',
  baseOid: 'b',
  mergeBase: 'm',
  headCommit: '0123456789abcdef',
  files: [
    { path: 'wiki/a.md', status: 'M' },
    { path: 'wiki/gone.md', status: 'D' },
    { path: 'wiki/new-name.md', status: 'R', from: 'wiki/old-name.md' },
    { path: 'src/x.ts', status: 'A' },
  ],
};
const M: DocChange = { status: 'M', hunks: [{ start: 1, end: 2 }], removed: [], added: 3, deleted: 1 };

const render = (over: Partial<Parameters<typeof PrDetailPanel>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(PrDetailPanel, {
      changes,
      change: null,
      changesError: null,
      changeError: null,
      path: 'wiki/a.md',
      agent: false,
      src: SRC,
      navigate: () => {},
      ...over,
    }),
  );

test('PrDetailPanel: 번호 링크·작성자·브랜치·머리·로컬 기준 안내', () => {
  const h = render();
  assert.match(h, /<a class="pr-detail-num" href="https:\/\/github.com\/o\/r\/pull\/927" target="_blank" rel="noreferrer"[^>]*>#927<\/a>/);
  assert.match(h, /PR 리뷰 모드/);
  assert.match(h, /steve · <span class="pr-detail-ref">feat\/x<\/span> → <span class="pr-detail-ref">master<\/span>/);
  assert.match(h, /머리 <code>01234567<\/code>/);
  assert.match(h, /역링크·검색은 로컬 기준/);
  assert.match(h, /바뀐 파일 4/);
});

test('PrDetailPanel: md 는 리더 링크, D 는 취소선, R 은 옛 → 새, 그 밖은 앱 안 파일 보기 링크', () => {
  const h = render();
  assert.match(h, /<a href="\/v\/wiki\/a.md\?src=pr:927" data-vault-path="wiki\/a.md">wiki\/a.md<\/a>/);
  assert.match(h, /<span class="pr-file-deleted">wiki\/gone.md<\/span>/);
  assert.doesNotMatch(h, /href="[^"]*gone/);
  assert.match(h, /data-vault-path="wiki\/new-name.md">wiki\/old-name.md → wiki\/new-name.md<\/a>/);
  assert.match(h, /<a href="\/v\/src\/x.ts\?src=pr:927" data-vault-path="src\/x.ts">src\/x.ts<\/a>/);
  assert.doesNotMatch(h, /pull\/927\/files/);
});

test('PrDetailPanel: 지금 문서 행 강조, 목록에 있으면 추가·삭제 줄과 이동 단추', () => {
  const none = render();
  assert.match(none, /class="pr-file pr-file-current" aria-current="true"><span[^>]*>M<\/span><a[^>]*>wiki\/a.md/);
  assert.doesNotMatch(none, /다음 변경/);
  const h = render({ change: M });
  assert.match(h, /추가 3줄 · 삭제 1줄 · 블록 0개/);
  assert.match(h, /이전 변경/);
  assert.match(h, /다음 변경/);
  // 그린 블록을 세기 전(SSR)엔 꺼져 있다.
  assert.match(h, /<button type="button" class="pr-detail-btn" disabled="">다음 변경<\/button>/);
  assert.doesNotMatch(render({ change: { ...M, status: null } }), /추가 3줄/);
});

test('PrDetailPanel: 받기 전·실패·문서 변경 실패', () => {
  assert.match(render({ changes: null }), /불러오는 중…/);
  assert.match(render({ changes: null, changesError: '503' }), /변경 목록을 못 읽었다/);
  const h = render({ change: M, changeError: 'ref 가 없다: refs/kv/base/master' });
  assert.match(h, /이 문서의 변경을 못 읽었다: ref 가 없다/);
  assert.doesNotMatch(h, /추가 3줄/);
});

test('PrBadge: 글·머리 7자·툴팁·data-pr·data-head, 단추', () => {
  const h = renderToStaticMarkup(createElement(PrBadge, { changes, onClick: () => {} }));
  assert.match(h, /^<button type="button" class="pr-badge"/);
  assert.match(h, /title="steve · feat\/x → master · 01234567"/);
  assert.match(h, /data-pr="927"/);
  assert.match(h, /data-head="0123456789abcdef"/);
  assert.match(h, /<span class="pr-badge-title">PR #927 · PR 리뷰 모드<\/span><span class="pr-badge-head">@ 0123456<\/span><\/button>$/);
});

test('PrDetailPanel·PrBadge: 머리는 읽은 커밋, gh 머리와 다르면 PR 머리 미반영', () => {
  const lag = { ...changes, headOid: 'ffffffff00000000', headCommit: 'abcdef0123456789' };
  const panel = render({ changes: lag });
  assert.match(panel, /머리 <code>abcdef01<\/code>/);
  assert.match(panel, /<span class="pr-head-lag" title="gh 머리 ffffffff · 읽은 커밋 abcdef01">PR 머리 미반영<\/span>/);
  assert.doesNotMatch(render(), /PR 머리 미반영/);
  const badge = renderToStaticMarkup(createElement(PrBadge, { changes: lag, onClick: () => {} }));
  assert.match(badge, /data-head="abcdef0123456789"/);
  assert.match(badge, /<span class="pr-badge-head">@ abcdef0<\/span>/);
  assert.match(badge, /<span class="pr-head-lag" title="gh 머리 ffffffff · 읽은 커밋 abcdef01">PR 머리 미반영<\/span>/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(PrBadge, { changes, onClick: () => {} })), /미반영/);
});

test('PrBadge: 에이전트 모드는 단추가 아니라 글, 머리 oid 는 글로 남는다', () => {
  const h = renderToStaticMarkup(createElement(PrBadge, { changes, onClick: () => {}, agent: true }));
  assert.match(h, /^<span class="pr-badge"[^>]*data-pr="927" data-head="0123456789abcdef">/);
  assert.doesNotMatch(h, /<button/);
  assert.match(h, /<span class="pr-badge-head">@ 0123456<\/span>/);
});

test('VaultBadge: main 의 마지막 fetch 가 실패했으면 (오래됨) 과 툴팁의 사유·가져온 때', () => {
  const now = Date.parse('2026-10-23T09:05:00Z');
  const info = {
    name: 'v',
    branch: 'b',
    head: 'aaaaaaa',
    worktree: false,
    dirty: false,
    sources: { main: { available: true, head: 'abc1234', fetchedAt: Date.parse('2026-10-23T09:00:00Z'), reason: 'fetch 실패: timeout' }, local: { available: true, head: 'aaaaaaa' } },
  };
  const h = renderToStaticMarkup(createElement(VaultBadge, { info, src: { kind: 'main' }, head: 'abc1234', now }));
  assert.match(h, /<span class="vault-badge-branch">origin\/master @ abc1234<\/span><span class="vault-badge-stale">\(오래됨\)<\/span>/);
  assert.match(h, /가져온 때: 5분 전/);
  assert.match(h, /갱신 실패: fetch 실패: timeout/);
  const ok = { ...info, sources: { ...info.sources, main: { available: true, head: 'abc1234', fetchedAt: now } } };
  const fresh = renderToStaticMarkup(createElement(VaultBadge, { info: ok, src: { kind: 'main' }, head: 'abc1234', now }));
  assert.doesNotMatch(fresh, /오래됨/);
  assert.match(fresh, /가져온 때: 방금/);
  const pr = renderToStaticMarkup(createElement(VaultBadge, { info: ok, src: SRC, head: null, srcReason: '503', now }));
  assert.match(pr, /변경 목록을 못 읽었다: 503/);
  assert.doesNotMatch(pr, /가져온 때/);
});
