// 통합 보기의 스타일 격리: 셸 CSS 는 루트 아래로 갇히고(scopeCss), 바깥 앱 CSS 는 루트 안을 피한다(excludeCss).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { excludeCss, excludeSelector, listSelectors, scopeCss, scopeSelector, splitSelectors } from '../../loader/scope-css.ts';

const STYLES = path.join(import.meta.dirname, '..', '..', 'src', 'styles');
const ROOT = '.pv-root';

test('셸 CSS 전부: 변환 뒤 모든 규칙 선택자가 루트로 시작하고, 규칙 수는 그대로다', () => {
  for (const name of fs.readdirSync(STYLES).filter((f) => f.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(STYLES, name), 'utf8');
    const before = listSelectors(css);
    const after = listSelectors(scopeCss(css, ROOT));
    assert.equal(after.length, before.length, name);
    for (const sel of after) assert.ok(sel.startsWith(ROOT), `${name}: 갇히지 않은 선택자 ${sel}`);
    // 문서 루트를 직접 가리키는 선택자가 남지 않는다(전역 * · body · :root 누수 방지).
    for (const sel of after) assert.doesNotMatch(sel, /(^|[\s,>+~])(:root|html|body)(?![\w-])/, `${name}: ${sel}`);
  }
});

test('문서 루트 앞머리는 루트 요소 자신이 되고, 뒤 조건은 남는다', () => {
  assert.equal(scopeSelector(':root', ROOT), ROOT);
  assert.equal(scopeSelector(":root[data-theme='dark']", ROOT), `${ROOT}[data-theme='dark']`);
  assert.equal(scopeSelector(":root:not([data-theme='light'])", ROOT), `${ROOT}:not([data-theme='light'])`);
  assert.equal(scopeSelector('html', ROOT), ROOT);
  assert.equal(scopeSelector('body', ROOT), ROOT);
  assert.equal(scopeSelector('html body', ROOT), ROOT);
  assert.equal(scopeSelector('*::before', ROOT), `${ROOT} *::before`);
  assert.equal(scopeSelector('.topbar > a', ROOT), `${ROOT} .topbar > a`);
  // 이름이 비슷한 클래스·요소는 앞머리로 보지 않는다.
  assert.equal(scopeSelector('.body-text', ROOT), `${ROOT} .body-text`);
  assert.equal(scopeSelector('bodyx', ROOT), `${ROOT} bodyx`);
});

test('@media 안은 다시 가두고, @keyframes·@font-face 는 그대로, 주석은 지운다', () => {
  const css = [
    '/* 머리 주석 { } */',
    '.a, .b:is(.c, .d) { color: red; }',
    '@media (max-width: 900px) { .panel { position: fixed; } }',
    '@keyframes spin { from { transform: rotate(0); } to { transform: rotate(1turn); } }',
    "@font-face { font-family: 'X'; src: url('a.woff2'); }",
    '.q::after { content: "} {"; }',
  ].join('\n');
  const out = scopeCss(css, ROOT);
  assert.doesNotMatch(out, /머리 주석/);
  assert.match(out, /\.pv-root \.a,\n\.pv-root \.b:is\(\.c, \.d\) \{/);
  assert.match(out, /@media \(max-width: 900px\) \{\n\.pv-root \.panel \{/);
  assert.match(out, /@keyframes spin \{ from \{ transform: rotate\(0\); \} to/);
  assert.match(out, /@font-face \{ font-family: 'X'/);
  assert.match(out, /\.pv-root \.q::after \{ content: "\} \{"; \}/);
});

test('선택자 목록은 괄호·속성값 안의 쉼표에서 나누지 않는다', () => {
  assert.deepEqual(splitSelectors('a, b:not(.x, .y), [data-x="1,2"]'), ['a', 'b:not(.x, .y)', '[data-x="1,2"]']);
});

test('바깥 앱 CSS: 맨 오른쪽 복합 선택자에 :not(루트 *)를 붙이되 의사 요소 앞에 넣는다', () => {
  assert.equal(excludeSelector('button', ROOT), 'button:not(.pv-root *)');
  assert.equal(excludeSelector('.doc h2', ROOT), '.doc h2:not(.pv-root *)');
  assert.equal(excludeSelector('.a > .b:hover', ROOT), '.a > .b:hover:not(.pv-root *)');
  assert.equal(excludeSelector('*::before', ROOT), '*:not(.pv-root *)::before');
  assert.equal(excludeSelector('.col:hover::-webkit-scrollbar-thumb', ROOT), '.col:hover:not(.pv-root *)::-webkit-scrollbar-thumb');
  assert.equal(excludeSelector('a:after', ROOT), 'a:not(.pv-root *):after');
  assert.equal(excludeSelector('.x:not(.y .z)', ROOT), '.x:not(.y .z):not(.pv-root *)');
  assert.equal(excludeSelector('[data-k="a b"]', ROOT), '[data-k="a b"]:not(.pv-root *)');
  const out = excludeCss('@media (min-width: 1px) { .a, .b { x: y } } @keyframes k { 0% { x: y } }', ROOT);
  assert.match(out, /\.a:not\(\.pv-root \*\),\n\.b:not\(\.pv-root \*\)/);
  assert.match(out, /@keyframes k \{ 0% \{ x: y \} \}/);
});
