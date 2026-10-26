// WCAG 2.x 대비 계산. 순수 모듈이다 — 테마 시험(tests/ui/themes.test.ts)과 README 의 대비 표가 이것으로 잰다.
// 정의: https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio · https://www.w3.org/TR/WCAG21/#dfn-relative-luminance

/** `#rgb`·`#rrggbb` 를 [r, g, b](0~255)로. 다른 꼴이면 null. */
export function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (m === null) return null;
  const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

const channel = (v: number): number => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** 상대 휘도(0 검정 ~ 1 흰색). hex 가 아니면 던진다. */
export function luminance(color: string): number {
  const rgb = parseHex(color);
  if (rgb === null) throw new Error(`hex 색이 아니다: ${color}`);
  const [r, g, b] = rgb.map(channel) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 두 색의 대비 비율(1 ~ 21). 순서와 무관하다. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** 본문 글(AA, 보통 크기)의 하한. */
export const AA_TEXT = 4.5;
/** 큰 글·UI 요소(AA)의 하한. */
export const AA_UI = 3;
