// 근거 패널이 가로로 넘치지 않게 하는 CSS 규칙이 살아 있는지 본다. 긴 상태 메모(배지 안 메모)가
// 한 줄로 늘어 패널 전체에 가로 스크롤이 생긴 적이 있다. 실제 폭 실측은 브라우저에서 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../src/styles/layout.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** 선택자 목록에 sel이 들어 있는 규칙 본문을 모두 이어 붙인다. */
function rulesFor(sel: string): string {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1]!.split(',').map((s) => s.trim()).includes(sel))
    .map((m) => m[2]!)
    .join('\n');
}

test('패널은 가로로 넘치지 않는다', () => {
  assert.match(rulesFor('.panel'), /overflow-x:\s*hidden/);
  assert.match(rulesFor('.panel > *'), /min-width:\s*0/);
});

test('상태 배지의 메모는 줄을 바꾸고 상태 이름은 끊지 않는다', () => {
  const badge = rulesFor('.panel .badge');
  assert.match(badge, /white-space:\s*normal/);
  assert.match(badge, /flex-wrap:\s*wrap/);
  assert.match(badge, /word-break:\s*keep-all/);
  const note = rulesFor('.panel .badge__note');
  assert.match(note, /overflow-wrap:\s*anywhere/);
  assert.match(note, /min-width:\s*0/);
  // 단계 상세의 배지도 같은 규칙
  assert.equal(rulesFor('.stages__detail .badge__note'), note);
});

test('패널의 원문 버튼(긴 경로)도 줄을 바꾼다', () => {
  const btn = rulesFor('.panel .btn');
  assert.match(btn, /white-space:\s*normal/);
  assert.match(btn, /overflow-wrap:\s*anywhere/);
  assert.match(btn, /max-width:\s*100%/);
});

const blocksCss = readFileSync(new URL('../../src/styles/blocks.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('단계 상세의 필드 칸은 긴 인라인 코드도 칸 안에서 줄을 바꾼다', () => {
  const rule = (sel: string) =>
    [...blocksCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => m[1]!.split(',').map((x) => x.trim()).includes(sel))
      .map((m) => m[2]!)
      .join('\n');
  const item = rule('.stages__metaItem');
  assert.match(item, /min-width:\s*0/);
  assert.match(item, /overflow-wrap:\s*anywhere/);
  assert.match(rule('.stages__metaItem code'), /overflow-wrap:\s*anywhere/);
  assert.match(rule('.stages__meta'), /minmax\(min\(100%,\s*190px\),\s*1fr\)/);
});

test('단계 상세의 칸 이름은 작은 제목이고, 칸마다 위쪽에 흐린 구분선이 있다', () => {
  const rule = (sel: string) =>
    [...blocksCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => m[1]!.split(',').map((x) => x.trim()).includes(sel))
      .map((m) => m[2]!)
      .join('\n');
  const label = rule('.stages__metaLabel');
  assert.match(label, /font-size:\s*var\(--fs-sm\)/);
  assert.match(label, /font-weight:\s*(600|700)/);
  assert.match(label, /color:\s*var\(--text(-2)?\)/);
  // 줄을 바꿔 1~4열이 되어도 칸마다 같은 선 — 왼쪽 선이 아니라 위쪽 선
  const item = rule('.stages__metaItem');
  assert.match(item, /border-top:\s*1px solid var\(--line\)/);
  assert.match(item, /padding-top:/);
});

test('근거 패널 옆에 스크롤 막대가 둘 서지 않는다 — 넓은 화면은 본문 칸과 패널만 각자 구른다', () => {
  // 패널은 더 이상 문서 스크롤 위에 sticky로 붙지 않는다(그러면 문서 막대 + 패널 막대가 나란히 선다)
  const panel = rulesFor('.panel');
  assert.doesNotMatch(panel, /position:\s*sticky/);
  assert.match(panel, /overflow-y:\s*auto/);
  // 넓은 화면: 앱은 높이를 고정하고 문서는 구르지 않는다. 본문 칸이 스크롤 칸이다
  const wide = css.slice(css.indexOf('@media (min-width: 901px)'));
  assert.ok(wide.length > 0);
  const inWide = (sel: string) =>
    [...wide.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => m[1]!.split(',').map((x) => x.trim()).includes(sel))
      .map((m) => m[2]!)
      .join('\n');
  assert.match(inWide('.app'), /height:\s*100%/);
  assert.match(inWide('.app'), /overflow:\s*hidden/);
  assert.match(inWide('.main'), /min-height:\s*0/);
  // 페이지 안쪽에도 .page가 있으므로 바깥 칸만 겨눈다
  assert.match(inWide('.main > .page'), /overflow-y:\s*auto/);
  assert.match(inWide('.main > .page'), /min-height:\s*0/);
  assert.equal(inWide('.page'), '');
  assert.match(inWide('.panel'), /max-height:\s*calc\(100%/);
});

test('닫기 버튼은 작게 한 줄로 두고, 패널 머리의 제목 쪽이 줄을 바꾼다', () => {
  const close = rulesFor('.panel .panel__close');
  assert.match(close, /white-space:\s*nowrap/);
  assert.match(close, /flex:\s*none/);
  assert.match(close, /font-size:\s*var\(--fs-xs\)/);
  // 줄바꿈을 허용하는 .panel .btn 규칙보다 뒤에 있어야 이긴다
  assert.ok(css.indexOf('.panel .panel__close') > css.indexOf('.panel .btn'));
  assert.match(rulesFor('.panel__head > div'), /flex:\s*1 1 auto/);
});

test('근거 패널의 필드 이름도 작은 제목이고, 필드 사이에 흐린 구분선이 있다', () => {
  const label = rulesFor('.panel__fieldLabel');
  assert.match(label, /font-size:\s*var\(--fs-sm\)/);
  assert.match(label, /font-weight:\s*(600|700)/);
  assert.match(label, /color:\s*var\(--text(-2)?\)/);
  assert.match(rulesFor('.panel__field + .panel__field'), /border-top:\s*1px solid var\(--line\)/);
});
