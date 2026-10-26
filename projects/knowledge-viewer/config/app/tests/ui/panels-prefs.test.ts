import { test } from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/tsx-hooks.ts';
import { PREFS_VERSION, isCollapsed, loadPrefs, movePanel, normalizePrefs, toggleCollapsed, togglePanel, visiblePanels } from '../../src/panels/prefs.ts';

const P = [{ id: 'a' }, { id: 'b' }, { id: 'c', defaultOn: false }];
const DEFAULT = { order: ['a', 'b', 'c'], off: ['c'], collapsed: [] };
// 저장값 모양 — 세대 번호가 맞아야 읽는다.
const saved = (order: string[], off: string[], collapsed?: string[]) => ({ v: PREFS_VERSION, order, off, ...(collapsed === undefined ? {} : { collapsed }) });

test('normalizePrefs: 모르는 id 는 버리고 빠진 id 는 가장 가까운 앞 패널 뒤(없으면 끝)에 끼운다', () => {
  // a 는 앞 패널이 없어 끝, c 는 앞 패널 b 바로 뒤.
  assert.deepEqual(normalizePrefs(saved(['b', 'zz'], ['zz', 'a']), P), { order: ['b', 'c', 'a'], off: ['a', 'c'], collapsed: [] });
});

test('normalizePrefs: 저장 뒤에 생긴 패널은 등록부의 앞 패널 바로 뒤에 선다', () => {
  const R = [{ id: 'meta' }, { id: 'prdetail' }, { id: 'toc' }, { id: 'backlinks' }];
  assert.deepEqual(normalizePrefs(saved(['meta', 'toc', 'backlinks'], []), R), { order: ['meta', 'prdetail', 'toc', 'backlinks'], off: [], collapsed: [] });
  // 사용자가 옮겨 둔 순서에서도 앞 패널(meta)을 따라간다.
  assert.deepEqual(normalizePrefs(saved(['toc', 'meta', 'backlinks'], []), R).order, ['toc', 'meta', 'prdetail', 'backlinks']);
});

test('normalizePrefs: 객체 아님·배열 아님은 기본값(defaultOn false 만 off)', () => {
  assert.deepEqual(normalizePrefs('x', P), DEFAULT);
  assert.deepEqual(normalizePrefs(null, P), DEFAULT);
  assert.deepEqual(normalizePrefs(saved('a' as unknown as string[], 1 as unknown as string[]), P), DEFAULT);
  assert.deepEqual(normalizePrefs(saved(['a', 3] as unknown as string[], [null] as unknown as string[]), P), DEFAULT);
});

test('normalizePrefs: 명시된 빈 off 는 defaultOn false 패널도 켠다(사용자가 켠 것)', () => {
  assert.deepEqual(normalizePrefs(saved(['a', 'b', 'c'], []), P), { order: ['a', 'b', 'c'], off: [], collapsed: [] });
});

test('loadPrefs: storage 가 던지거나 값이 깨져도 기본값', () => {
  assert.deepEqual(
    loadPrefs(P, {
      getItem: () => {
        throw new Error('x');
      },
    }),
    DEFAULT,
  );
  assert.deepEqual(loadPrefs(P, { getItem: () => '{not json' }), DEFAULT);
  assert.deepEqual(loadPrefs(P, { getItem: () => null }), DEFAULT);
  assert.deepEqual(loadPrefs(P, { getItem: () => JSON.stringify(saved(['c', 'a', 'b'], [])) }), { order: ['c', 'a', 'b'], off: [], collapsed: [] });
});

test('loadPrefs: storage 가 없으면(기본 인자) 기본값', () => {
  assert.deepEqual(loadPrefs(P), DEFAULT);
});

test('savePrefs: 키 knowledge-viewer.panels 에 JSON 으로 쓰고, storage 가 던져도 조용하다', async () => {
  const { savePrefs, PREFS_KEY } = await import('../../src/panels/prefs.ts');
  const put: string[] = [];
  savePrefs({ order: ['a'], off: [], collapsed: [] }, { setItem: (k, v) => put.push(k, v) });
  assert.deepEqual(put, [PREFS_KEY, `{"v":${PREFS_VERSION},"order":["a"],"off":[],"collapsed":[]}`]);
  assert.equal(PREFS_KEY, 'knowledge-viewer.panels');
  savePrefs({ order: ['a'], off: [], collapsed: [] }, {
    setItem: () => {
      throw new Error('quota');
    },
  });
});

test('visiblePanels: order 순서로, off 는 뺀다', () => {
  assert.deepEqual(visiblePanels(P, { order: ['b', 'a', 'c'], off: ['c'], collapsed: [] }).map((p) => p.id), ['b', 'a']);
});

test('movePanel: 위로·아래로, 끝에서는 그대로', () => {
  const prefs = { order: ['b', 'a', 'c'], off: ['c'], collapsed: [] };
  assert.deepEqual(movePanel(prefs, 'a', -1).order, ['a', 'b', 'c']);
  assert.deepEqual(movePanel(prefs, 'b', -1).order, ['b', 'a', 'c']);
  assert.deepEqual(movePanel(prefs, 'c', 1).order, ['b', 'a', 'c']);
  assert.deepEqual(movePanel(prefs, 'a', 1).order, ['b', 'c', 'a']);
  assert.deepEqual(movePanel(prefs, 'zz', 1), prefs);
});

test('togglePanel: 끄고 켠다', () => {
  const prefs = { order: ['b', 'a', 'c'], off: ['c'], collapsed: [] };
  assert.deepEqual(togglePanel(prefs, 'c').off, []);
  assert.deepEqual(togglePanel(prefs, 'a').off, ['c', 'a']);
});

test('세대 번호가 없거나 다르면(옛 저장값) 기본값으로 돌아간다 — 기본 배치를 바꿨을 때', () => {
  assert.deepEqual(normalizePrefs({ order: ['c', 'b', 'a'], off: [] }, P), DEFAULT);
  assert.deepEqual(normalizePrefs({ v: PREFS_VERSION - 1, order: ['c', 'b', 'a'], off: [] }, P), DEFAULT);
});

test('접힘: 기본은 defaultCollapsed, 저장값에 없으면 기본, 있으면 그대로(모르는 id 는 버림)', () => {
  const Q = [{ id: 'a' }, { id: 'p', defaultCollapsed: true }, { id: 'q', defaultCollapsed: true }];
  assert.deepEqual(normalizePrefs(null, Q).collapsed, ['p', 'q']);
  assert.deepEqual(normalizePrefs(saved(['a', 'p', 'q'], []), Q).collapsed, ['p', 'q'], '옛 저장값(collapsed 없음)은 기본 접힘');
  assert.deepEqual(normalizePrefs(saved(['a', 'p', 'q'], [], []), Q).collapsed, [], '사용자가 다 폈으면 빈 채로');
  assert.deepEqual(normalizePrefs(saved(['a', 'p', 'q'], [], ['q', 'zz', 'q']), Q).collapsed, ['q']);
  // 저장 뒤에 생긴 접힘 패널은 접힌 채 들어온다.
  assert.deepEqual(normalizePrefs(saved(['a'], [], []), Q).collapsed, ['p', 'q']);
});

test('toggleCollapsed·isCollapsed: 접고 편다', () => {
  const prefs = { order: ['a', 'p'], off: [], collapsed: ['p'] };
  assert.equal(isCollapsed(prefs, 'p'), true);
  assert.deepEqual(toggleCollapsed(prefs, 'p').collapsed, []);
  assert.deepEqual(toggleCollapsed(prefs, 'a').collapsed, ['p', 'a']);
});

test('등록부 기본: 연결 지도 → 목차 → 역링크 순, 북마크는 끔, 진행 중 PR·뷰어 모음은 접힘', async () => {
  const { PANELS } = await import('../../src/panels/registry.ts');
  const d = normalizePrefs(null, PANELS);
  const pos = (id: string) => d.order.indexOf(id);
  assert.ok(pos('graph') < pos('toc') && pos('toc') < pos('backlinks'), d.order.join(','));
  assert.deepEqual(d.off, ['bookmarks']);
  assert.deepEqual(d.collapsed, ['prs', 'viewers']);
});
