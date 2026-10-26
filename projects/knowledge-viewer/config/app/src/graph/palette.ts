// 문서 종류별 그래프 색. 값의 정본은 src/styles/tokens.css 의 `--graph-<kind>` 이고, 여기서는 이름과 읽기만 맡는다.
// 캔버스는 밝은·어두운 테마 모두 `--graph-bg: #0b1017` 이라 색도 두 테마에서 같다.
// WCAG 대비 비율은 `--graph-bg` 기준이고 전부 3:1 이상이다. 색상(H)은 HSL 각도다.
// 중심에 닿는 간선은 테마의 `--accent` 가 아니라 `--graph-accent` 다 — 밝은 테마 `--accent`(#0f6b6b)는 이 캔버스에서 3.03:1 뿐이다.
//
// | kind      | 값      | 대비   | H    | 메모                         |
// | --------- | ------- | ------ | ---- | ---------------------------- |
// | concept   | #f2777a | 6.99   | 359  | 위키 — 산호 빨강             |
// | tool      | #f5a25d | 9.27   | 27   | 위키 — 주황                  |
// | model     | #b5d96a | 11.90  | 79   | 위키 — 연두                  |
// | framework | #5cc98a | 9.25   | 145  | 위키 — 초록                  |
// | pattern   | #a58cf5 | 6.97   | 254  | 위키 — 보라                  |
// | protocol  | #d98ce8 | 8.06   | 290  | 위키 — 자주                  |
// | topic     | #f283b8 | 7.92   | 331  | 위키 — 분홍                  |
// | project   | #57bdb5 | 8.50   | 175  | `--accent`(다크) 계열 청록   |
// | idea      | #f2d45c | 13.03  | 48   | 노랑                         |
// | doc       | #5b9cf0 | 6.78   | 214  | 파랑                         |
// | output    | #7d8995 | 5.35   | 210  | 저채도 회색 — 어두운 쪽      |
// | other     | #b8c1ca | 10.46  | 210  | 저채도 회색 — 밝은 쪽        |
// | (accent)  | #57bdb5 | 8.50   | 175  | `--graph-accent` — 중심 간선 |
//
// 순수 모듈이다 — window 없이 import 된다. getComputedStyle 은 함수 안에서만 부른다.
import type { Kind } from '../../shared/kind.ts';

const FALLBACK = '#888';

/** 종류의 색 변수 이름. */
export function colorVarOf(kind: Kind): string {
  return `--graph-${kind}`;
}

/** el 에서 계산된 CSS 변수 값. 브라우저 밖이거나 값이 비면 `#888` 이다. */
export function readVar(name: string, el: Element): string {
  if (typeof getComputedStyle === 'undefined') return FALLBACK;
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v === '' ? FALLBACK : v;
}

/** 종류의 색. */
export function readColor(kind: Kind, el: Element): string {
  return readVar(colorVarOf(kind), el);
}

/** `#rgb`·`#rrggbb` 색에 투명도를 붙인 `rgba(…)`. hex 가 아니면 그대로 돌려준다(투명도는 잃는다). */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (m === null) return color;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
