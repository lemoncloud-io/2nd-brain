// 빌드 스탬프 — 넓은 화면은 본문 왼쪽 아이콘 레일, 좁은 화면은 하단 띠. 마크업은 SSR로, 모양은 CSS 문자열로 본다.
// 실제 폭·위치 실측은 브라우저에서 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { Bundle } from '../../model/types.ts';
import { withSsr } from './ssr.ts';

const bundle = JSON.parse(readFileSync(new URL('../fixtures/sample-bundle.json', import.meta.url), 'utf8')) as Bundle;

type Comp = (props: Record<string, unknown>) => React.ReactElement;

// 주석을 지운 layout.css 와 그 안의 넓은 화면(901px~) 묶음
const css = readFileSync(new URL('../../src/styles/layout.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');

/** 짝 맞는 중괄호로 @media 묶음 본문을 꺼낸다. */
function mediaBody(query: string): string {
  const at = css.indexOf(`@media ${query}`);
  assert.ok(at >= 0, `${query} 묶음이 없다`);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') depth -= 1;
    if (depth === 0) return css.slice(open + 1, i);
  }
  return '';
}

/** 선택자 목록에 sel이 들어 있는 규칙 본문을 이어 붙인다. */
function rulesFor(text: string, sel: string): string {
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1]!.split(',').map((s) => s.trim()).includes(sel))
    .map((m) => m[2]!)
    .join('\n');
}

const wide = mediaBody('(min-width: 901px)');
const top = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');

test('스탬프 마크업: 칸마다 16px 선 아이콘, 포커스되고 aria-label·말풍선 글(data-tip)에 이름과 전체 값', async () => {
  const html = await withSsr(async (load) => {
    const m = (await load('/src/app/StampBar.tsx')) as { StampBar: Comp };
    return renderToStaticMarkup(createElement(m.StampBar, { bundle }));
  });
  // 아이콘은 인라인 SVG, 색은 글자색, 읽는 이에게 숨김
  const icons = html.match(/<svg class="stampbar__icon"[^>]*>/g) ?? [];
  assert.equal(icons.length, 5 + 4 + 1, '스탬프 5칸 + 경고 4칩 + 경고 전체');
  for (const svg of icons) {
    assert.match(svg, /width="16"/);
    assert.match(svg, /stroke="currentColor"/);
    assert.match(svg, /aria-hidden="true"/);
  }
  // 아이콘 모양은 서로 다르다 — 아이콘만으로 뜻이 갈려야 한다
  const paths = [...html.matchAll(/<svg class="stampbar__icon"[^>]*><path d="([^"]+)"/g)].map((x) => x[1]);
  assert.equal(new Set(paths).size, paths.length);
  // 정적 칸은 포커스되는 그림(role=img), aria-label 과 말풍선 글이 같다
  const tips: Record<string, string> = {
    빌드: '빌드 · ',
    커밋: '커밋 · 9a3f71c2e5b80d4416aa (dirty',
    문서: '문서 5개',
    yml: 'yml 해시 · 3f9c1a7b22de',
    원장: '원장 해시 · b41e77c0a9d3',
  };
  for (const [label, tip] of Object.entries(tips)) {
    const esc = tip.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const item = new RegExp(`<span class="stampbar__item[^"]*" tabindex="0" role="img" aria-label="(${esc}[^"]*)" data-tip="([^"]*)">`).exec(html);
    assert.ok(item, `칸 없음: ${label}`);
    assert.equal(item[1], item[2], `${label}: aria-label 과 말풍선 글이 같아야 한다`);
  }
  // 해시·시각은 레일에서 숨는 text 값, 문서 수만 count 값
  assert.equal((html.match(/stampbar__value--count/g) ?? []).length, 1);
  assert.equal((html.match(/stampbar__value--text/g) ?? []).length, 4);
  assert.ok(html.includes('stampbar__item stampbar__item--dirty'));
  // 이름은 .stampbar__label 로 남는다(띠에서 보이고 레일에서 숨김)
  for (const label of ['빌드', '커밋', '문서', 'yml', '원장', '범위 밖 링크', '참고 원본 누락', '미확인 코드 근거', '물려받은 근거', '경고 전체'])
    assert.ok(html.includes(`<span class="stampbar__label">${label}</span>`), `이름 없음: ${label}`);
  // 네이티브 title 툴팁은 쓰지 않는다(말풍선과 겹친다)
  assert.doesNotMatch(html, / title="/);
  // 위 묶음(스탬프 값)과 아래 묶음(경고 칩)
  assert.equal((html.match(/class="stampbar__group(?: stampbar__group--warn)?"/g) ?? []).length, 2);
  // 말풍선은 가리키기 전에는 없다
  assert.ok(!html.includes('stampbar__tip'));
});

test('경고 칩: 0이 아니면 amber 단추, 0이면 흐린 포커스 칸 — 둘 다 aria-label·말풍선 글', async () => {
  const html = await withSsr(async (load) => {
    const m = (await load('/src/app/StampBar.tsx')) as { StampBar: Comp };
    return renderToStaticMarkup(createElement(m.StampBar, { bundle }));
  });
  const hot = html.match(/<button type="button" class="stampbar__warn stampbar__warn--hot"[^>]*>/g) ?? [];
  assert.equal(hot.length, 3, '범위 밖 링크 1 · 미확인 코드 1 · 물려받은 근거 3');
  assert.ok(
    hot.some(
      (b) => b.includes('aria-label="물려받은 근거 3건"') && b.includes('data-tip="물려받은 근거 3건 · 눌러서 목록"') && b.includes('aria-expanded="false"'),
    ),
  );
  assert.match(html, /<span class="stampbar__warn stampbar__warn--zero" tabindex="0" role="img" aria-label="참고 원본 누락 0건" data-tip="참고 원본 누락 0건">/);
  assert.match(html, /<button type="button" class="stampbar__warn"[^>]*aria-label="경고 전체 5건"/);
  // 닫힌 상태에서는 목록이 없다
  assert.ok(!html.includes('stampbar__issues'));
});

test('펼친 경고 목록: 머리에 종류 이름과 닫기, 항목은 코드·메시지·위치', async () => {
  const html = await withSsr(async (load) => {
    const m = (await load('/src/app/StampBar.tsx')) as { StampIssues: Comp };
    const issues = bundle.issues.filter((i) => i.code === 'W_INHERITED');
    return [
      renderToStaticMarkup(createElement(m.StampIssues, { label: '물려받은 근거', issues, onClose: () => {} })),
      renderToStaticMarkup(createElement(m.StampIssues, { label: '참고 원본 누락', issues: [], onClose: () => {} })),
    ];
  });
  assert.match(html[0]!, /<div class="stampbar__issues" role="region" aria-label="물려받은 근거 목록">/);
  assert.match(html[0]!, /<strong>물려받은 근거<\/strong><button type="button" class="btn stampbar__close">닫기<\/button>/);
  assert.match(html[0]!, /<div class="stampbar__issue"><code>W_INHERITED<\/code>/);
  assert.match(html[1]!, /집계 수만 있다/);
});

test('넓은 화면: 앱은 격자(상단 띠 / 레일 + 본문)이고 레일 폭은 토큰이다', () => {
  assert.match(tokens, /--stamprail-w:\s*(4[89]|5\d)px/, '레일 폭 48~56px');
  const app = rulesFor(wide, '.app');
  assert.match(app, /display:\s*grid/);
  assert.match(app, /grid-template-columns:\s*var\(--stamprail-w\)\s+minmax\(0,\s*1fr\)/);
  assert.match(app, /'bar bar'\s*'rail main'/);
  assert.match(app, /position:\s*relative/);
  assert.match(app, /height:\s*100%/);
  assert.match(rulesFor(wide, '.appbar'), /grid-area:\s*bar/);
  assert.match(rulesFor(wide, '.main'), /grid-area:\s*main/);
  const rail = rulesFor(wide, '.stampbar');
  assert.match(rail, /grid-area:\s*rail/);
  // 레일은 위치 기준이 아니다 — 목록 창이 레일 스크롤에 잘리지 않고 .app 기준으로 뜬다
  assert.match(rail, /position:\s*static/);
  assert.match(rail, /overflow-y:\s*auto/);
  assert.match(rulesFor(wide, '.stampbar__row'), /flex-direction:\s*column/);
});

test('넓은 화면: 글자 없는 레일 — 이름은 화면에서만 숨기고, 해시·시각 값은 감추고, 말풍선·경고 목록은 레일 오른쪽에 뜬다', () => {
  const label = rulesFor(wide, '.stampbar__label');
  assert.match(label, /position:\s*absolute/);
  assert.match(label, /clip-path:\s*inset\(50%\)/);
  assert.doesNotMatch(label, /display:\s*none/, '읽는 이에게는 이름이 남아야 한다');
  assert.match(rulesFor(wide, '.stampbar__value--text'), /display:\s*none/);
  assert.match(rulesFor(wide, '.stampbar__item'), /white-space:\s*nowrap/);
  assert.match(rulesFor(wide, '.stampbar__item'), /align-items:\s*center/);
  assert.match(rulesFor(wide, '.stampbar__warn--zero'), /opacity:/);
  assert.match(rulesFor(wide, '.stampbar__item:focus-visible'), /background:/);
  const tip = rulesFor(wide, '.stampbar__tip');
  assert.match(tip, /display:\s*block/);
  assert.match(tip, /position:\s*absolute/);
  assert.match(tip, /left:\s*calc\(var\(--stamprail-w\)/);
  assert.match(tip, /pointer-events:\s*none/);
  const fly = rulesFor(wide, '.stampbar__issues');
  assert.match(fly, /position:\s*absolute/);
  assert.match(fly, /left:\s*calc\(var\(--stamprail-w\)/);
  assert.match(fly, /z-index:\s*\d+/);
  assert.match(fly, /width:\s*min\(/);
});

test('좁은 화면(기본): 하단 띠는 그대로 아래에 붙고 이름이 보인다', () => {
  const bar = rulesFor(top, '.stampbar');
  assert.match(bar, /position:\s*sticky/);
  assert.match(bar, /bottom:\s*0/);
  assert.match(rulesFor(top, '.stampbar__row'), /min-height:\s*var\(--stampbar-h\)/);
  assert.equal(rulesFor(top, '.stampbar__label'), '', '기본 규칙은 이름을 숨기지 않는다');
  assert.match(rulesFor(top, '.stampbar__tip'), /display:\s*none/, '띠에서는 말풍선을 쓰지 않는다');
  assert.match(rulesFor(top, '.stampbar__warn--hot'), /var\(--tone-amber-bg\)/);
  assert.match(rulesFor(top, '.stampbar__issues'), /overflow-y:\s*auto/);
});
