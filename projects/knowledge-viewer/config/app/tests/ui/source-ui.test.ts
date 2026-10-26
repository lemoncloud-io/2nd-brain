import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LOCAL, MAIN } from '../../shared/source.ts';
import { badgeText, firstChangedMd, labelOf, prBadgeHead, prHeadLag, prTooltip, sourceOptions, staleness } from '../../src/app/source-ui.ts';

test('sourceOptions: main · local · pr:<n> 순', () => {
  const o = sourceOptions([{ number: 927, title: 't' }], true);
  assert.deepEqual(
    o.map((x) => x.value),
    ['main', 'local', 'pr:927'],
  );
  assert.equal(o[0]?.label, '메인 (master)');
  assert.equal(o[1]?.label, '로컬 (워크트리)');
  assert.equal(o[2]?.label, 'PR #927 t');
  assert.ok(o.every((x) => x.disabled !== true));
});

test('sourceOptions: mainAvailable false 면 main 이 disabled', () => {
  const o = sourceOptions([], false);
  assert.deepEqual(
    o.map((x) => x.value),
    ['main', 'local'],
  );
  assert.equal(o[0]?.disabled, true);
  assert.notEqual(o[1]?.disabled, true);
});

test('sourceOptions: 제목은 40자 남짓에서 자르고 PR 은 20개까지', () => {
  const long = '가'.repeat(60);
  const prs = Array.from({ length: 25 }, (_, i) => ({ number: i + 1, title: i === 0 ? long : `p${i + 1}` }));
  const o = sourceOptions(prs, true);
  assert.equal(o.length, 2 + 20);
  assert.equal(o[2]?.label, `PR #1 ${'가'.repeat(40)}…`);
});

test('sourceOptions: 목록에 없는 현재 PR 도 항목으로 남는다', () => {
  const o = sourceOptions([{ number: 1, title: 'a' }], true, { kind: 'pr', number: 927 });
  assert.deepEqual(
    o.map((x) => x.value),
    ['main', 'local', 'pr:1', 'pr:927'],
  );
  assert.equal(o[3]?.label, 'PR #927');
  // 목록에 있으면 겹치지 않는다.
  const p = sourceOptions([{ number: 927, title: 't' }], true, { kind: 'pr', number: 927 });
  assert.deepEqual(
    p.map((x) => x.value),
    ['main', 'local', 'pr:927'],
  );
});

test('labelOf: 소스 이름', () => {
  assert.equal(labelOf({ kind: 'pr', number: 927 }), 'PR #927');
  assert.equal(labelOf(MAIN), '메인 (master)');
  assert.equal(labelOf(LOCAL), '로컬 (워크트리)');
});

test('badgeText: main · pr 의 머리 표시, local 은 null', () => {
  assert.equal(badgeText(MAIN, 'abc1234'), 'origin/master @ abc1234');
  assert.equal(badgeText(MAIN, null), 'origin/master');
  assert.equal(badgeText({ kind: 'pr', number: 927 }, 'def5678'), 'PR #927 @ def5678');
  assert.equal(badgeText({ kind: 'pr', number: 927 }, null), 'PR #927');
  assert.equal(badgeText(LOCAL, 'abc1234'), null);
});

test('firstChangedMd: 현재 문서가 바뀐 md 면 null(머문다)', () => {
  const files = [
    { path: 'wiki/a.md', status: 'M' as const },
    { path: 'wiki/b.md', status: 'A' as const },
  ];
  assert.equal(firstChangedMd(files, 'wiki/b.md'), null);
});

test('firstChangedMd: 아니면 지워지지 않은 첫 md', () => {
  const files = [
    { path: 'outputs/x.html', status: 'M' as const },
    { path: 'wiki/gone.md', status: 'D' as const },
    { path: 'wiki/new.md', status: 'R' as const, from: 'wiki/old.md' },
    { path: 'wiki/z.md', status: 'M' as const },
  ];
  assert.equal(firstChangedMd(files, 'wiki/INDEX.md'), 'wiki/new.md');
  // 지워진 md 를 보고 있었어도 옮긴다.
  assert.equal(firstChangedMd(files, 'wiki/gone.md'), 'wiki/new.md');
});

test('firstChangedMd: 바뀐 md 가 없으면 null', () => {
  assert.equal(firstChangedMd([], 'wiki/INDEX.md'), null);
  assert.equal(firstChangedMd([{ path: 'a.ts', status: 'M' }, { path: 'b.md', status: 'D' }], 'wiki/INDEX.md'), null);
});

const PRC = { author: 'steve', head: 'feat/x', base: 'master', headOid: '0123456789abcdef', headCommit: '0123456789abcdef' };

test('prBadgeHead·prTooltip: gh 머리가 아니라 읽은 커밋(headCommit)', () => {
  const c = { ...PRC, headOid: 'ffffffff00000000', headCommit: 'abcdef0123456789' };
  assert.equal(prBadgeHead(c), 'abcdef0');
  assert.equal(prTooltip(c), 'steve · feat/x → master · abcdef01');
});

test('prHeadLag: 같으면 null, 다르면 PR 머리 미반영 + 두 oid', () => {
  assert.equal(prHeadLag(PRC), null);
  // 짧은 꼴로 시작하면 같다고 본다.
  assert.equal(prHeadLag({ headOid: '0123456', headCommit: '0123456789abcdef' }), null);
  // gh 가 머리를 주지 않았으면 비교하지 않는다.
  assert.equal(prHeadLag({ headOid: '', headCommit: '0123456789abcdef' }), null);
  assert.deepEqual(prHeadLag({ headOid: 'ffffffff00000000', headCommit: '0123456789abcdef' }), {
    text: 'PR 머리 미반영',
    title: 'gh 머리 ffffffff · 읽은 커밋 01234567',
  });
});

test('staleness: 사유가 있으면 (오래됨) 과 툴팁 줄, 없으면 가져온 때만', () => {
  assert.deepEqual(staleness(undefined, 0), { suffix: null, lines: [] });
  const fresh = staleness({ fetchedAt: Date.parse('2026-10-23T09:00:00Z'), reason: undefined }, Date.parse('2026-10-23T09:00:30Z'));
  assert.deepEqual(fresh, { suffix: null, lines: ['가져온 때: 방금'] });
  const old = staleness({ fetchedAt: Date.parse('2026-10-23T09:00:00Z'), reason: 'fetch 실패: timeout' }, Date.parse('2026-10-23T09:05:00Z'));
  assert.deepEqual(old, { suffix: '(오래됨)', lines: ['가져온 때: 5분 전', '갱신 실패: fetch 실패: timeout'] });
  assert.deepEqual(staleness({ fetchedAt: null, reason: 'x' }, 0), { suffix: '(오래됨)', lines: ['가져온 때: 이 서버에서 받은 적 없음', '갱신 실패: x'] });
});
