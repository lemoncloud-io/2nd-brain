// 셸 CSS 를 한 루트 클래스 아래로 가두는 순수 변환. 볼트 뷰어 통합 보기가 빌드할 때만 쓴다 —
// 셸 단독 빌드(cli build)는 이 파일을 부르지 않으므로 산출물이 바뀌지 않는다.
// 손으로 쓴 평범한 CSS(중첩 없음)를 전제로 한다: 규칙의 선택자에 접두를 붙이고, @media·@supports 안은 다시 들어가며,
// @keyframes·@font-face 같은 것은 그대로 둔다. 문서 루트를 가리키는 `:root`·`html`·`body`는 루트 요소 자신으로 바꾼다.
// 반대 방향(excludeCss)은 바깥 앱의 CSS 가 루트 안에 닿지 않게 선택자마다 `:not(<root> *)`를 붙인다.
// 주석은 지운다(브라우저만 읽는 결과물이다).

/** 안을 다시 변환하는 묶음 @규칙. 그 밖의 @규칙 블록(@keyframes·@font-face·@page …)은 그대로 둔다. */
const GROUPING = new Set(['media', 'supports', 'container', 'layer', 'document', 'scope']);

/** 문서 루트를 뜻하는 앞머리. 뒤에 이어지는 조건(`[data-theme]`·`:not(…)`)은 그대로 붙는다. */
const ROOT_HEAD = /^(?::root|html|body)(?![\w-])/;

/** 문자열 안이 아닌 주석을 지운다. */
export function stripComments(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const c = css[i]!;
    // 문자열은 통째로 옮긴다(안의 `/*` 는 주석이 아니다).
    if (c === '"' || c === "'") {
      const end = skipString(css, i);
      out += css.slice(i, end);
      i = end;
      continue;
    }
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** 따옴표로 시작하는 문자열의 끝(닫는 따옴표 다음) 위치. */
function skipString(css: string, start: number): number {
  const quote = css[start];
  let i = start + 1;
  while (i < css.length) {
    if (css[i] === '\\') {
      i += 2;
      continue;
    }
    if (css[i] === quote) return i + 1;
    i += 1;
  }
  return css.length;
}

/** start 다음에서 깊이 0의 `{`·`;`·`}` 중 처음 것. 없으면 -1. */
function nextStop(css: string, start: number): number {
  let depth = 0;
  for (let i = start; i < css.length; i += 1) {
    const c = css[i]!;
    if (c === '"' || c === "'") {
      i = skipString(css, i) - 1;
      continue;
    }
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (depth <= 0 && (c === '{' || c === ';' || c === '}')) return i;
  }
  return -1;
}

/** open 위치의 `{`와 짝인 `}` 위치. 없으면 끝. */
function matchBrace(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    const c = css[i]!;
    if (c === '"' || c === "'") {
      i = skipString(css, i) - 1;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return css.length;
}

/** 선택자 목록을 깊이 0의 쉼표로 나눈다(`:is(a, b)`·`[x=","]` 안의 쉼표는 나누지 않는다). */
export function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i]!;
    if (c === '"' || c === "'") {
      i = skipString(list, i) - 1;
      continue;
    }
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (c === ',' && depth === 0) {
      out.push(list.slice(from, i));
      from = i + 1;
    }
  }
  out.push(list.slice(from));
  return out.map((s) => s.trim()).filter((s) => s !== '');
}

/** 선택자 하나에 접두를 붙인다. 문서 루트 앞머리는 루트 요소 자신이 된다. */
export function scopeSelector(selector: string, root: string): string {
  const s = selector.trim();
  if (ROOT_HEAD.test(s)) {
    // `html body`·`:root body` 처럼 루트가 둘 겹친 꼴도 한 번만 루트로 본다.
    const rest = s.replace(ROOT_HEAD, '').replace(/^\s+(?:html|body)(?![\w-])/, '');
    return `${root}${rest}`;
  }
  return `${root} ${s}`;
}

/** 옛 한 쌍점 의사 요소. 이것 뒤에는 의사 클래스를 붙일 수 없다. */
const LEGACY_PSEUDO_ELEMENT = /^:(?:before|after|first-line|first-letter)(?![\w-])/i;

/**
 * 선택자 하나가 루트 안의 요소에 닿지 않게 한다(바깥 앱 CSS 용). 맨 오른쪽 복합 선택자에
 * `:not(<root> *)`를 붙이되, 의사 요소(`::before`) 앞에 넣는다 — 의사 요소 뒤의 의사 클래스는 문법 오류다.
 */
export function excludeSelector(selector: string, root: string): string {
  const s = selector.trim();
  const guard = `:not(${root} *)`;
  // 맨 오른쪽 복합 선택자의 시작: 깊이 0의 마지막 결합자(공백·>·+·~) 다음.
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i]!;
    if (c === '"' || c === "'") {
      i = skipString(s, i) - 1;
      continue;
    }
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~' || c === '\n' || c === '\t')) start = i + 1;
  }
  // 그 복합 선택자 안에서 깊이 0의 첫 의사 요소 자리.
  depth = 0;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i]!;
    if (c === '"' || c === "'") {
      i = skipString(s, i) - 1;
      continue;
    }
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (depth === 0 && c === ':' && (s[i + 1] === ':' || LEGACY_PSEUDO_ELEMENT.test(s.slice(i)))) {
      return `${s.slice(0, i)}${guard}${s.slice(i)}`;
    }
  }
  return `${s}${guard}`;
}

/** 규칙을 하나씩 돌며 선택자를 바꾼다. 묶음 @규칙 안은 다시 들어가고, 그 밖 @규칙은 그대로다. */
function mapRules(css: string, map: (selector: string) => string): string {
  const text = stripComments(css);
  let out = '';
  let i = 0;
  while (i < text.length) {
    const stop = nextStop(text, i);
    if (stop === -1) {
      out += text.slice(i);
      break;
    }
    const prelude = text.slice(i, stop).trim();
    const ch = text[stop];
    if (ch === ';' || ch === '}') {
      // `@import …;` 같은 문장형 @규칙이나 남은 닫는 괄호는 그대로 옮긴다.
      if (prelude !== '' || ch === '}') out += `${prelude}${ch}\n`;
      i = stop + 1;
      continue;
    }
    const close = matchBrace(text, stop);
    const body = text.slice(stop + 1, close);
    i = close + 1;
    if (prelude.startsWith('@')) {
      const name = (/^@([\w-]+)/.exec(prelude)?.[1] ?? '').toLowerCase();
      // 묶음 @규칙은 안을 다시 변환하고, 그 밖(@keyframes 의 from·to 등)은 손대지 않는다.
      out += GROUPING.has(name) ? `${prelude} {\n${mapRules(body, map)}}\n` : `${prelude} {${body}}\n`;
      continue;
    }
    out += `${splitSelectors(prelude).map(map).join(',\n')} {${body}}\n`;
  }
  return out;
}

/** 바깥 앱의 CSS 가 루트 안(셸)에 닿지 않게 한다. 반대 방향은 scopeCss 다. */
export function excludeCss(css: string, root: string): string {
  return mapRules(css, (sel) => excludeSelector(sel, root));
}

/** CSS 한 덩어리(파일 또는 묶음 @규칙의 안)를 루트 아래로 가둔다. */
export function scopeCss(css: string, root: string): string {
  return mapRules(css, (sel) => scopeSelector(sel, root));
}

/** 변환 결과의 모든 규칙 선택자(시험·점검용). @keyframes 안의 단계 선택자는 뺀다. */
export function listSelectors(css: string): string[] {
  const text = stripComments(css);
  const found: string[] = [];
  let i = 0;
  while (i < text.length) {
    const stop = nextStop(text, i);
    if (stop === -1) break;
    const prelude = text.slice(i, stop).trim();
    if (text[stop] !== '{') {
      i = stop + 1;
      continue;
    }
    const close = matchBrace(text, stop);
    const body = text.slice(stop + 1, close);
    i = close + 1;
    if (prelude.startsWith('@')) {
      const name = (/^@([\w-]+)/.exec(prelude)?.[1] ?? '').toLowerCase();
      if (GROUPING.has(name)) found.push(...listSelectors(body));
      continue;
    }
    found.push(...splitSelectors(prelude));
  }
  return found;
}
