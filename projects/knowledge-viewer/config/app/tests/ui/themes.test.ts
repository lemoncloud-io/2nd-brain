// 화면 테마: 등록부(src/app/themes.ts)와 테마 CSS(src/styles/themes/<id>.css)가 맞는지,
// 테마마다 토큰이 빠짐없이 있는지, 본문 대비가 WCAG AA 인지 본다. CSS 는 파일을 읽어 정규식으로 푼다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AA_TEXT, AA_UI, contrastRatio } from '../../src/app/contrast.ts';
import { DEFAULT_THEME, findTheme, isScheme, isThemeId, resolveDark, themeAttrs, THEMES } from '../../src/app/themes.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const STYLES = path.resolve(here, '../../src/styles');
const read = (p: string) => fs.readFileSync(path.join(STYLES, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

type Block = { selector: string; vars: Map<string, string>; inDarkMedia: boolean };

/** 최상위·@media 안의 `선택자 { --x: v; }` 규칙을 푼다. @media (prefers-color-scheme: dark) 안이면 표시한다. */
function blocks(css: string): Block[] {
  const out: Block[] = [];
  const media = [...css.matchAll(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{/g)].map((m) => m.index!);
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1]!.trim().replace(/^@media[^{]*$/, '');
    const vars = new Map([...m[2]!.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1]!, d[2]!.trim().toLowerCase()]));
    // 이 규칙 앞의 가장 가까운 @media 가 아직 닫히지 않았으면 그 안이다.
    const open = media.filter((i) => i < m.index!).pop();
    const inDarkMedia = open !== undefined && !css.slice(open, m.index!).replace(/@media[^{]*\{/, '').includes('}');
    out.push({ selector, vars, inDarkMedia });
  }
  return out;
}

// 필수 토큰 = tokens.css 의 [data-scheme='dark'] 블록(색 토큰 전부). 라이트 :root 도 같은 색 집합을 가져야 한다.
const tokens = blocks(read('tokens.css'));
const vaultDark = tokens.find((b) => b.selector === ":root[data-scheme='dark']")!;
const vaultDarkMedia = tokens.find((b) => b.selector === ":root:not([data-scheme='light'])")!;
const vaultLight = tokens.find((b) => b.selector === ':root')!;
const REQUIRED = [...vaultDark.vars.keys()];

test('tokens.css: 다크 블록 둘이 같고 라이트 :root 에 같은 색 토큰이 다 있다', () => {
  assert.ok(REQUIRED.length >= 40, `색 토큰 ${REQUIRED.length} 개`);
  assert.ok(vaultDarkMedia.inDarkMedia);
  assert.deepEqual(new Map(vaultDarkMedia.vars), new Map(vaultDark.vars));
  for (const k of REQUIRED) assert.ok(vaultLight.vars.has(k), `:root 에 ${k} 없음`);
  // 예전 이름(data-theme 로 밝기 강제)이 남아 있지 않다 — data-theme 는 이제 테마 id 다.
  assert.doesNotMatch(read('tokens.css'), /data-theme='(light|dark)'/);
});

test('등록부: id 유일, 기본 vault 가 처음, 다섯 테마 모두 라이트·다크·출처', () => {
  const ids = THEMES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[0], DEFAULT_THEME);
  assert.deepEqual(ids, ['vault', 'github', 'dracula', 'catppuccin', 'tokyo-night', 'solarized']);
  for (const t of THEMES) {
    assert.ok(t.light && t.dark, `${t.id} 라이트·다크`);
    assert.match(t.id, /^[a-z][a-z0-9-]*$/);
    if (t.id !== DEFAULT_THEME) assert.match(t.source ?? '', /^https:\/\//, `${t.id} 출처`);
  }
});

test('isThemeId·findTheme·isScheme: 모르는 값은 기본', () => {
  assert.ok(isThemeId('dracula'));
  assert.ok(!isThemeId('nord'));
  assert.ok(!isThemeId(undefined));
  assert.equal(findTheme('nope').id, 'vault');
  assert.equal(findTheme(null).id, 'vault');
  assert.ok(isScheme('auto') && isScheme('light') && isScheme('dark'));
  assert.ok(!isScheme('dim'));
});

test('themeAttrs: auto 는 data-scheme 를 빼고, 모르는 값은 기본으로', () => {
  assert.deepEqual(themeAttrs('github', 'auto'), { theme: 'github', scheme: null });
  assert.deepEqual(themeAttrs('github', 'dark'), { theme: 'github', scheme: 'dark' });
  assert.deepEqual(themeAttrs('nope', 'dim'), { theme: 'vault', scheme: null });
});

test('resolveDark: data-scheme 가 OS 설정보다 먼저다', () => {
  assert.equal(resolveDark('dark', false), true);
  assert.equal(resolveDark('light', true), false);
  assert.equal(resolveDark(undefined, true), true);
  assert.equal(resolveDark(null, false), false);
});

test('묶음 index.css 는 등록된 테마(vault 제외) 파일을 빠짐없이, 그것만 불러온다', () => {
  const imports = [...read('themes/index.css').matchAll(/@import '\.\/([a-z0-9-]+)\.css';/g)].map((m) => m[1]!);
  assert.deepEqual(
    imports,
    THEMES.filter((t) => t.id !== DEFAULT_THEME).map((t) => t.id),
  );
  const files = fs.readdirSync(path.join(STYLES, 'themes')).filter((f) => f !== 'index.css');
  assert.deepEqual(files.sort(), imports.map((i) => `${i}.css`).sort());
});

type Pal = Map<string, string>;
/** 테마별 [라이트, 다크] 팔레트. vault 는 tokens.css 에서 읽는다. */
function palettes(id: string): { light: Pal; dark: Pal } {
  if (id === DEFAULT_THEME) return { light: vaultLight.vars, dark: vaultDark.vars };
  const bs = blocks(read(`themes/${id}.css`));
  const sel = `:root[data-theme='${id}']`;
  const light = bs.filter((b) => b.selector === sel && !b.inDarkMedia);
  const media = bs.filter((b) => b.selector === `${sel}:not([data-scheme='light'])` && b.inDarkMedia);
  const forced = bs.filter((b) => b.selector === `${sel}[data-scheme='dark']` && !b.inDarkMedia);
  assert.equal(light.length, 1, `${id}: 라이트 블록 ${sel}`);
  assert.equal(media.length, 1, `${id}: @media 다크 블록`);
  assert.equal(forced.length, 1, `${id}: data-scheme=dark 블록`);
  assert.equal(bs.length, 3, `${id}: 블록은 셋뿐`);
  assert.deepEqual(new Map(media[0]!.vars), new Map(forced[0]!.vars), `${id}: 다크 블록 둘의 값이 같다`);
  return { light: light[0]!.vars, dark: forced[0]!.vars };
}

for (const t of THEMES.filter((x) => x.id !== DEFAULT_THEME)) {
  test(`${t.id}: 라이트·다크 블록이 토큰 집합을 빠짐없이, 더하지 않고 정의한다`, () => {
    const { light, dark } = palettes(t.id);
    for (const [name, p] of [
      ['라이트', light],
      ['다크', dark],
    ] as const) {
      assert.deepEqual([...p.keys()].sort(), [...REQUIRED].sort(), `${t.id} ${name}`);
      for (const [k, v] of p) assert.match(v, /^#[0-9a-f]{6}$/, `${t.id} ${name} ${k}=${v}`);
    }
    // 지도 캔버스는 늘 어둡다 — --graph-* 는 라이트·다크가 같은 값이고 바탕이 어둡다.
    for (const k of REQUIRED.filter((x) => x.startsWith('--graph-'))) assert.equal(light.get(k), dark.get(k), `${t.id} ${k}`);
    assert.ok(contrastRatio(light.get('--graph-bg')!, '#000000') < 2, `${t.id} --graph-bg 가 어둡다`);
  });
}

// 대비 하한. 본문 글은 바탕 셋(--bg 는 가운데 열, --surface 는 양옆 열, --surface-2 는 코드 블록) 위에서 AA.
const CHECKS: [string, string, number][] = [
  ['--text', '--bg', AA_TEXT],
  ['--text', '--surface', AA_TEXT],
  ['--text', '--surface-2', AA_TEXT],
  ['--text', '--surface-3', AA_TEXT],
  ['--text-2', '--bg', AA_TEXT],
  ['--text-2', '--surface', AA_TEXT],
  ['--text-3', '--surface', AA_UI],
  ['--accent', '--bg', AA_TEXT],
  ['--accent', '--surface', AA_TEXT],
  // PR 하이라이트·배지·알림의 글/바탕
  ['--tone-muted-fg', '--tone-muted-bg', AA_TEXT],
  ['--tone-blue-fg', '--tone-blue-bg', AA_TEXT],
  ['--tone-amber-fg', '--tone-amber-bg', AA_TEXT],
  ['--tone-green-fg', '--tone-green-bg', AA_TEXT],
  ['--tone-red-fg', '--tone-red-bg', AA_TEXT],
];

for (const t of THEMES) {
  test(`${t.id}: 대비 — 본문 글 4.5:1, 흐린 글 3:1, tone 글 4.5:1, 지도 색 3:1 이상`, () => {
    const p = palettes(t.id);
    for (const [scheme, pal] of [
      ['light', p.light],
      ['dark', p.dark],
    ] as const) {
      for (const [fg, bg, min] of CHECKS) {
        const r = contrastRatio(pal.get(fg)!, pal.get(bg)!);
        assert.ok(r >= min, `${t.id} ${scheme} ${fg}/${bg} = ${r.toFixed(2)} < ${min}`);
      }
      for (const k of REQUIRED.filter((x) => x.startsWith('--graph-') && x !== '--graph-bg')) {
        const r = contrastRatio(pal.get(k)!, pal.get('--graph-bg')!);
        assert.ok(r >= AA_UI, `${t.id} ${scheme} ${k} on --graph-bg = ${r.toFixed(2)}`);
      }
    }
  });
}
