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

const SRC = { kind: 'pr', number: 123 } as const;
const changes: PrChanges = {
  number: 123,
  title: 'PR 리뷰 모드',
  author: 'steve',
  head: 'feat/x',
  base: 'master',
  headOid: '0123456789abcdef',
  state: 'OPEN',
  updatedAt: '2026-10-23T00:00:00Z',
  url: 'https://github.com/o/r/pull/123',
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
      onExit: () => {},
      ...over,
    }),
  );

test('PrDetailPanel: 번호 링크·작성자·브랜치·머리·로컬 기준 안내', () => {
  const h = render();
  assert.match(h, /<a class="pr-detail-num" href="https:\/\/github.com\/o\/r\/pull\/123" target="_blank" rel="noreferrer"[^>]*>#123<\/a>/);
  assert.match(h, /PR 리뷰 모드/);
  assert.match(h, /steve · <span class="pr-detail-ref">feat\/x<\/span> → <span class="pr-detail-ref">master<\/span>/);
  assert.match(h, /머리 <code>01234567<\/code>/);
  assert.match(h, /역링크·검색은 로컬 기준/);
  assert.match(h, /바뀐 파일 4/);
});

test('PrDetailPanel: 폴더 트리 — 잎은 파일 이름, 전체 경로는 title·data-vault-path, D 는 취소선, R 은 ← 옛 경로', () => {
  const h = render();
  // 폴더가 파일보다 앞이고 이름순: src, wiki. 폴더는 <details open> 이라 접힌다.
  assert.match(h, /<ul class="pr-detail-files pr-tree"><li class="pr-dir"><details open=""><summary class="pr-dir-name" title="src">src\/<\/summary>/);
  assert.match(h, /<a href="\/v\/wiki\/a.md\?src=pr:123" data-vault-path="wiki\/a.md" title="wiki\/a.md">a.md<\/a>/);
  assert.match(h, /<span class="pr-file-deleted" title="wiki\/gone.md">gone.md<\/span>/);
  assert.doesNotMatch(h, /href="[^"]*gone/);
  assert.match(h, /data-vault-path="wiki\/new-name.md" title="wiki\/new-name.md">new-name.md <span class="pr-file-from">← wiki\/old-name.md<\/span><\/a>/);
  assert.match(h, /<a href="\/v\/src\/x.ts\?src=pr:123" data-vault-path="src\/x.ts" title="src\/x.ts">x.ts<\/a>/);
  assert.doesNotMatch(h, /pull\/123\/files/);
  // 상태 글자는 잎에만, 뜻은 title.
  assert.match(h, /<span class="pr-file-status pr-file-status-A" title="추가">A<\/span>/);
  assert.equal((h.match(/pr-file-status-/g) ?? []).length, 4);
});

test('PrDetailPanel: 지금 문서 행 강조, 목록에 있으면 추가·삭제 줄과 이동 단추', () => {
  const none = render();
  assert.match(none, /class="pr-file pr-file-current" aria-current="true"><span[^>]*>M<\/span><a[^>]*>a.md/);
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
  assert.match(h, /data-pr="123"/);
  assert.match(h, /data-head="0123456789abcdef"/);
  assert.match(h, /<span class="pr-badge-title">PR #123 · PR 리뷰 모드<\/span><span class="pr-badge-head">@ 0123456<\/span><\/button>$/);
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

test('PrDetailPanel·PrBadge: 상태 알약 — MERGED 는 머지됨, CLOSED 는 닫힘, OPEN 은 없음', () => {
  const merged = { ...changes, state: 'MERGED' as const, mergeCommit: 'e8cdd003aaaaaaaa', headCommit: 'e8cdd003aaaaaaaa' };
  const m = render({ changes: merged });
  assert.match(m, />#123<\/a> <span class="pr-state pr-state-merged">머지됨<\/span> <span>PR 리뷰 모드<\/span>/);
  // 머지 커밋을 읽으면 머리 대신 머지 커밋, gh 머리와 달라도 미반영 표시는 없다.
  assert.match(m, /머지 <code>e8cdd003<\/code>/);
  assert.doesNotMatch(m, /머리 <code>/);
  assert.doesNotMatch(m, /미반영/);
  const c = render({ changes: { ...changes, state: 'CLOSED' } });
  assert.match(c, /<span class="pr-state pr-state-closed">닫힘<\/span>/);
  assert.match(c, /머리 <code>01234567<\/code>/);
  const o = render();
  assert.doesNotMatch(o, /pr-state/);
  assert.doesNotMatch(o, /머지됨|닫힘/);
  const badge = renderToStaticMarkup(createElement(PrBadge, { changes: merged, onClick: () => {} }));
  assert.match(badge, /<span class="pr-badge-title">PR #123 · PR 리뷰 모드<\/span><span class="pr-state pr-state-merged">머지됨<\/span><span class="pr-badge-head">@ e8cdd00<\/span><\/button>$/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(PrBadge, { changes, onClick: () => {} })), /pr-state/);
});

test('PrDetailPanel: 머지 커밋을 못 받아 PR 머리로 뜨면 머리 표시와 note, 머지 커밋 미반영', () => {
  const fallback = { ...changes, state: 'MERGED' as const, mergeCommit: 'e8cdd003aaaaaaaa', note: '머지 커밋을 아직 받지 못해 PR 머리 기준으로 보인다' };
  const h = render({ changes: fallback });
  assert.match(h, /머지됨/);
  assert.match(h, /머리 <code>01234567<\/code>/);
  assert.match(h, /머지 커밋 미반영/);
  assert.match(h, /<p class="pr-detail-note">머지 커밋을 아직 받지 못해 PR 머리 기준으로 보인다<\/p>/);
});

test('PrBadge: 에이전트 모드는 단추가 아니라 글, 머리 oid 는 글로 남는다', () => {
  const h = renderToStaticMarkup(createElement(PrBadge, { changes, onClick: () => {}, agent: true }));
  assert.match(h, /^<span class="pr-badge"[^>]*data-pr="123" data-head="0123456789abcdef">/);
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

// 닫기 단추: 에이전트가 집는 data-action·aria-label 을 갖고, 목록을 못 받았어도 그린다.
test('PrDetailPanel: 닫기 단추(exit-pr)·aria-label', () => {
  for (const h of [render(), render({ changes: null })]) {
    assert.match(h, /<button type="button" class="icon-btn pr-detail-exit" data-action="exit-pr" aria-label="PR 리뷰 닫기 — 메인으로" title="PR 리뷰 닫기 — 메인으로">/);
  }
});

// 등록부: pr 소스의 PR 상세가 onExit 를 setSource 로 잇는다 — main, main 못 쓰면 local.
test('registry prdetail: onExit → setSource({kind:main}), main 불가면 local', async () => {
  const { PANELS } = await import('../../src/panels/registry.ts');
  const panel = PANELS.find((p) => p.id === 'prdetail')!;
  const calls: unknown[] = [];
  const ctx = {
    doc: null,
    path: 'wiki/a.md',
    agent: false,
    src: SRC,
    navigate: () => {},
    setSource: (s: unknown) => calls.push(s),
    changes,
    change: null,
    changesError: null,
  };
  const el = panel.render(ctx) as { props: { onExit: () => void } };
  el.props.onExit();
  assert.deepEqual(calls, [{ kind: 'main' }]);
  const el2 = panel.render({ ...ctx, mainAvailable: false }) as { props: { onExit: () => void } };
  el2.props.onExit();
  assert.deepEqual(calls[1], { kind: 'local' });
  // pr 소스가 아니면 그리지 않는다.
  assert.equal(panel.render({ ...ctx, src: { kind: 'main' } }), null);
});
