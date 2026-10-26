// Mermaid 다이어그램 테마 계약. 테마 하나 = 파일 하나. 등록은 registry.ts 의 배열이다.
import type { MermaidConfig } from 'mermaid';

export type MermaidTheme = {
  /** 설정 키(localStorage 에 남는다). 한 번 정하면 바꾸지 않는다. */
  id: string;
  /** 선택 상자에 보이는 이름. */
  title: string;
  /** 선택 상자 아래 한 줄 설명. */
  description: string;
  /**
   * mermaid.initialize 에 넘길 설정. `dark` 는 지금 화면이 다크인지다.
   * startOnLoad·securityLevel 은 Mermaid.tsx 가 덮어쓴다 — 여기서 정하지 않는다.
   * 색은 tokens.css 값을 그대로 옮겨 적는다(mermaid 는 CSS 변수에서 파생색을 못 만든다).
   * `screen` 은 화면 테마가 기본(vault)이 아닐 때 그 테마의 토큰 값(16진수)이다. 쓰는 테마만 쓴다(vault).
   */
  init: (dark: boolean, screen?: ScreenPalette) => MermaidConfig;
  /**
   * 그릇(.mermaid) 쪽 CSS. 선택. 문서 <head> 에 <style id="mermaid-theme-css"> 로 들어가며 테마를 바꾸면 통째로 바뀐다.
   * 선택자는 `.mermaid[data-mermaid-theme="<id>"]` 로 시작해 다른 테마에 새지 않게 한다.
   */
  css?: string;
};

/** 화면 테마의 색 토큰 중 다이어그램이 쓰는 것. 값은 `#rrggbb`. 이름은 tokens.css 의 `--<kebab>` 이다. */
export type ScreenPalette = {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  line: string;
  lineStrong: string;
  text: string;
  text2: string;
  text3: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  amberBg: string;
  amberFg: string;
  amberLine: string;
  redBg: string;
  redFg: string;
};

/** ScreenPalette 키 → CSS 변수 이름. */
export const SCREEN_PALETTE_VARS: Record<keyof ScreenPalette, string> = {
  bg: '--bg',
  surface: '--surface',
  surface2: '--surface-2',
  surface3: '--surface-3',
  line: '--line',
  lineStrong: '--line-strong',
  text: '--text',
  text2: '--text-2',
  text3: '--text-3',
  accent: '--accent',
  accentStrong: '--accent-strong',
  accentSoft: '--accent-soft',
  amberBg: '--tone-amber-bg',
  amberFg: '--tone-amber-fg',
  amberLine: '--tone-amber-line',
  redBg: '--tone-red-bg',
  redFg: '--tone-red-fg',
};

/** 변수 읽기 함수로 팔레트를 만든다. 하나라도 `#rrggbb` 가 아니면 null(그때는 테마 내장 팔레트). 순수 함수. */
export function screenPaletteFrom(get: (cssVar: string) => string): ScreenPalette | null {
  const out: Partial<ScreenPalette> = {};
  for (const [k, v] of Object.entries(SCREEN_PALETTE_VARS) as [keyof ScreenPalette, string][]) {
    const val = get(v).trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(val)) return null;
    out[k] = val;
  }
  return out as ScreenPalette;
}
