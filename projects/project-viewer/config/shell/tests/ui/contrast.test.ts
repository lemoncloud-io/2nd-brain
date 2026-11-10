// 묶음 띠·흐름 그림의 글자 대비(WCAG AA 4.5:1). tokens.css의 실제 값으로 밝은·어두운 테마를 모두 잰다.
// 묶음 틀 바탕은 color-mix(in srgb, tone-bg 50%, surface-2)라서 그 섞은 색과 양 끝 색을 함께 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');
const TONES = ['muted', 'blue', 'amber', 'green', 'red'] as const;

function block(selector: string): Record<string, string> {
  const at = css.indexOf(selector);
  assert.ok(at >= 0, `tokens.css에 ${selector}가 없다`);
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!]));
}
const THEMES = { light: block(':root {'), dark: block(":root[data-theme='dark'] {") };

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const mix = (a: Rgb, b: Rgb): Rgb => a.map((v, i) => (v + b[i]!) / 2) as Rgb;
function lum([r, g, b]: Rgb): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

for (const [name, t] of Object.entries(THEMES)) {
  const c = (k: string): Rgb => {
    assert.ok(t[k], `${name} 테마에 --${k}가 없다`);
    return rgb(t[k]!);
  };

  test(`${name}: 묶음 이름표(--text-2 on --surface)와 ▸(--text-2 on 묶음 바탕)가 AA`, () => {
    assert.ok(ratio(c('text-2'), c('surface')) >= 4.5);
    for (const tone of TONES) {
      for (const bg of [c(`tone-${tone}-bg`), c('surface-2'), mix(c(`tone-${tone}-bg`), c('surface-2'))]) {
        const r = ratio(c('text-2'), bg);
        assert.ok(r >= 4.5, `${tone} 묶음 바탕에서 --text-2 대비 ${r.toFixed(2)}`);
      }
    }
  });

  test(`${name}: 하위 칩·흐름 칸·선후 표지의 tone 글자(--tone-*-fg on --tone-*-bg)가 AA`, () => {
    for (const tone of TONES) {
      const r = ratio(c(`tone-${tone}-fg`), c(`tone-${tone}-bg`));
      assert.ok(r >= 4.5, `${tone} 대비 ${r.toFixed(2)}`);
      // 상태 알약은 --surface 바탕에 tone 글자
      const p = ratio(c(`tone-${tone}-fg`), c('surface'));
      assert.ok(p >= 4.5, `${tone} 알약 대비 ${p.toFixed(2)}`);
    }
  });

  test(`${name}: 단계 상세 칸 이름(--text-2 on --surface)이 AA`, () => {
    const r = ratio(c('text-2'), c('surface'));
    assert.ok(r >= 4.5, `칸 이름 대비 ${r.toFixed(2)}`);
  });

  // 폐기(struck)는 투명도 대신 바탕을 비워 가른다 — 그 바탕에서도 글자가 AA여야 한다
  test(`${name}: 폐기 표시(속 빈 배지·칩·흐름 칸, 회색 목록 줄, 점선 항목 칸)의 글자가 AA`, () => {
    for (const tone of TONES) {
      const r = ratio(c(`tone-${tone}-fg`), c('surface'));
      assert.ok(r >= 4.5, `${tone} 속 빈 배지·칩 대비 ${r.toFixed(2)}`);
    }
    for (const bg of ['bg', 'surface', 'surface-2']) {
      const r = ratio(c('tone-muted-fg'), c(bg));
      assert.ok(r >= 4.5, `목록 줄(--tone-muted-fg on --${bg}) 대비 ${r.toFixed(2)}`);
    }
    for (const k of ['text', 'text-2']) {
      for (const bg of ['surface', 'surface-2']) {
        const r = ratio(c(k), c(bg));
        assert.ok(r >= 4.5, `--${k} on --${bg} 대비 ${r.toFixed(2)}`);
      }
    }
  });

  // 폐기 칸은 한 단계 짙은 회색(--tone-muted-line) 바탕이다 — 회색 글자와 칸 안 본문 글자 모두 AA
  test(`${name}: 폐기 칸(--tone-muted-line·--surface-3 반반 바탕)의 글자가 AA`, () => {
    for (const k of ['tone-muted-fg', 'text', 'text-2']) {
      const r = ratio(c(k), mix(c('tone-muted-line'), c('surface-3')));
      assert.ok(r >= 4.5, `--${k} on 폐기 바탕 대비 ${r.toFixed(2)}`);
    }
  });

  test(`${name}: 흐름 칸 본문(--text·--text-2 on --tone-*-bg)이 AA`, () => {
    for (const tone of TONES) {
      for (const k of ['text', 'text-2']) {
        const r = ratio(c(k), c(`tone-${tone}-bg`));
        assert.ok(r >= 4.5, `${tone} 바탕의 --${k} 대비 ${r.toFixed(2)}`);
      }
    }
  });
}
