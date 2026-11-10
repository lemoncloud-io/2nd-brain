// 상태 장식(motion: pulse · struck: true)의 CSS 규칙이 살아 있는지 본다. 실제 움직임·색은 브라우저에서 잰다.
// 폐기 표시는 투명도로 흐리지 않는다 — 0.7이면 밝은 테마에서 글자 대비가 3:1 안팎으로 떨어진다(contrast.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const strip = (f: string) =>
  readFileSync(new URL(`../../src/styles/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const css = ['base.css', 'blocks.css', 'layout.css'].map(strip).join('\n');

function rulesFor(sel: string, text = css): string {
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1]!.split(',').map((s) => s.trim()).includes(sel))
    .map((m) => m[2]!)
    .join('\n');
}

test('진행 중 배지·알약 점은 같은 느린 숨(status-pulse)을 쓴다', () => {
  for (const sel of ['.badge--pulse::before', '.flow__pill--pulse::before']) {
    assert.match(rulesFor(sel), /animation:\s*status-pulse\s+2(\.\d+)?s/, sel);
  }
  assert.match(css, /@keyframes status-pulse/);
});

test('단계 띠 진행 중 칩은 테두리를 빛줄기가 돌고, 점은 가만히 있다', () => {
  // 회전 각도는 등록한 <angle> 속성이라 키프레임이 매끄럽게 돈다
  assert.match(css, /@property --stagestrip-spin\s*\{[^}]*syntax:\s*'<angle>'[^}]*initial-value:\s*0deg/);
  assert.match(css, /@keyframes stagestrip-spin\s*\{\s*to\s*\{\s*--stagestrip-spin:\s*360deg/);
  const chip = rulesFor('.stagestrip__item.stagestrip__item--pulse');
  assert.match(chip, /animation:\s*stagestrip-spin\s+2(\.\d+)?s\s+linear\s+infinite/);
  // 바탕은 tone 바탕색(padding-box), 테두리 자리는 도는 원뿔 그라데이션(border-box)
  assert.match(chip, /linear-gradient\(var\(--chip-bg\),\s*var\(--chip-bg\)\)\s*padding-box/);
  assert.match(chip, /conic-gradient\(from var\(--stagestrip-spin\),[^;]*var\(--chip-fg\)[^;]*\)\s*border-box/);
  assert.match(chip, /border-color:\s*transparent/);
  // 미지원 브라우저도 0deg 정적 테가 나오게 각도를 칩에 직접 둔다
  assert.match(chip, /--stagestrip-spin:\s*0deg/);
  // 테 2px + 안쪽 여백 1px 감소 = 다른 칩(1px 테, 3px 9px · 작은 칩 1px 6px)과 같은 크기
  assert.match(chip, /border-width:\s*2px/);
  assert.match(chip, /padding:\s*2px 8px/);
  assert.match(rulesFor('.stagestrip__item'), /padding:\s*3px 9px/);
  assert.match(rulesFor('.stagestrip__item--sub.stagestrip__item--pulse'), /padding:\s*0 5px/);
  assert.match(rulesFor('.stagestrip__item--sub'), /padding:\s*1px 6px/);
  // tone별 칩 색 변수
  for (const tone of ['muted', 'blue', 'amber', 'green', 'red']) {
    const body = rulesFor(`.stagestrip__item--${tone}`);
    for (const k of ['bg', 'line', 'fg']) assert.match(body, new RegExp(`--chip-${k}:\\s*var\\(--tone-${tone}-${k}\\)`), tone);
  }
  // 지금 보는 칩의 inset 테는 그대로(진행 중 규칙이 box-shadow를 덮지 않는다)
  assert.match(rulesFor(".stagestrip__item[aria-current='true']"), /box-shadow:\s*inset 0 0 0 1px var\(--accent\)/);
  assert.doesNotMatch(chip, /box-shadow/);
  // 깜박이는 링·점 키프레임은 없다 — 움직임은 회전 하나
  assert.doesNotMatch(css, /@keyframes stagestrip-(ring|dot)/);
  assert.doesNotMatch(css, /stagestrip__dot--pulse/);
});

test('단계 띠 칸은 링용 여백 맞바꿈이 없다(띠 높이·칩 자리 그대로)', () => {
  assert.match(rulesFor('.stagestrip__list'), /padding-bottom:\s*2px/);
  assert.doesNotMatch(rulesFor('.stagestrip__list'), /margin/);
  const row = rulesFor('.stagestrip__row');
  assert.match(row, /max-width:\s*100%/);
  assert.match(row, /padding-bottom:\s*2px/);
  assert.doesNotMatch(row, /margin/);
  assert.doesNotMatch(rulesFor('.stagestrip__list--nested'), /margin|padding/);
});

test('움직임 줄이기에서는 진행 중 숨·회전을 끄고 정적 표지만 남긴다', () => {
  const at = css.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(at >= 0);
  const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]!).join('\n');
  for (const sel of ['.badge--pulse::before', '.flow__pill--pulse::before', '.stagestrip__item--pulse']) {
    assert.match(rulesFor(sel, reduced), /animation:\s*none/, sel);
  }
  // 단계 칩은 회전 대신 tone 글자색 실선 테 — 진행 중임은 남는다
  const chip = rulesFor('.stagestrip__item.stagestrip__item--pulse', reduced);
  assert.match(chip, /animation:\s*none/);
  assert.match(chip, /background:\s*var\(--chip-bg\)/);
  assert.match(chip, /border-color:\s*var\(--chip-fg\)/);
});

test('폐기는 1.5px 취소선이고 투명도를 쓰지 않는다', () => {
  for (const sel of ['.strike', '.stagestrip__item--struck', '.is-struck .flow__short']) {
    const body = rulesFor(sel);
    assert.match(body, /text-decoration:\s*line-through/, sel);
    assert.match(body, /text-decoration-thickness:\s*1\.5px/, sel);
    assert.match(body, /text-decoration-color:\s*var\(--tone-muted-fg\)/, sel);
  }
  for (const sel of ['.strike', '.badge--struck', '.pick--struck', '.stages__listBtn--struck', '.flow__node.is-struck', '.stagestrip__item--struck']) {
    assert.doesNotMatch(rulesFor(sel), /opacity/, sel);
  }
  // 미착수(채운 회색)와 가르는 것은 속 빈 점선 테다
  for (const sel of ['.badge--struck', '.pick--struck', '.flow__node.is-struck', '.stagestrip__item--struck']) {
    assert.match(rulesFor(sel), /border-style:\s*dashed/, sel);
  }
});
