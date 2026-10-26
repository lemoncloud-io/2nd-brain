// 화면 테마 등록부. 순수 모듈이다 — DOM 을 만지지 않는다.
// 테마 하나 = `src/styles/themes/<id>.css` 하나(`[data-theme="<id>"]` 아래 라이트·다크 토큰). 기본 `vault` 는 tokens.css 그 자체다.
// 고르기·저장은 prefs/theme.ts, 적용은 theme-apply.ts. id 는 설정 키다 — 한 번 정하면 바꾸지 않는다.

export type ScreenTheme = {
  /** 설정 키이자 `<html data-theme>` 값. */
  id: string;
  /** 선택 상자에 보이는 이름. */
  title: string;
  /** 라이트·다크 이름(원 테마의 변형 이름). 선택 상자 아래 한 줄로 보인다. */
  variants: string;
  /** 라이트 변형이 있는가. */
  light: boolean;
  /** 다크 변형이 있는가. */
  dark: boolean;
  /** 팔레트 출처(원 테마의 공식 저장소·명세). 기본 테마는 null. */
  source: string | null;
};

export const THEMES: readonly ScreenTheme[] = [
  { id: 'vault', title: '볼트 (기본)', variants: '라이트 · 다크', light: true, dark: true, source: null },
  {
    id: 'github',
    title: 'GitHub',
    variants: 'Light · Dark',
    light: true,
    dark: true,
    source: 'https://github.com/primer/github-vscode-theme',
  },
  {
    id: 'dracula',
    title: 'Dracula',
    variants: 'Alucard · Dracula',
    light: true,
    dark: true,
    source: 'https://draculatheme.com/spec',
  },
  {
    id: 'catppuccin',
    title: 'Catppuccin',
    variants: 'Latte · Mocha',
    light: true,
    dark: true,
    source: 'https://github.com/catppuccin/catppuccin',
  },
  {
    id: 'tokyo-night',
    title: 'Tokyo Night',
    variants: 'Light · Night',
    light: true,
    dark: true,
    source: 'https://github.com/enkia/tokyo-night-vscode-theme',
  },
  {
    id: 'solarized',
    title: 'Solarized',
    variants: 'Light · Dark',
    light: true,
    dark: true,
    source: 'https://ethanschoonover.com/solarized/',
  },
];

/** 저장값이 없거나 모르는 id 일 때 쓰는 테마. */
export const DEFAULT_THEME = 'vault';

export function isThemeId(v: unknown): v is string {
  return typeof v === 'string' && THEMES.some((t) => t.id === v);
}

/** id 로 찾는다. 모르는 id 는 기본 테마다 — 테마를 빼도 저장된 설정이 깨지지 않는다. */
export function findTheme(id: unknown): ScreenTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME)!;
}

/** 밝기. `auto` 는 OS 설정(`prefers-color-scheme`)을 따른다. */
export type Scheme = 'auto' | 'light' | 'dark';
export const SCHEMES: readonly Scheme[] = ['auto', 'light', 'dark'];
export const DEFAULT_SCHEME: Scheme = 'auto';

export function isScheme(v: unknown): v is Scheme {
  return v === 'auto' || v === 'light' || v === 'dark';
}

/**
 * `<html>` 에 둘 속성. `data-scheme` 는 `auto` 면 빼서(null) CSS 가 OS 설정을 따르게 한다.
 * `data-theme` 는 늘 둔다(기본 `vault` 도) — Mermaid 가 화면 테마를 이 값으로 안다.
 */
export function themeAttrs(theme: unknown, scheme: unknown): { theme: string; scheme: 'light' | 'dark' | null } {
  const s = isScheme(scheme) ? scheme : DEFAULT_SCHEME;
  return { theme: findTheme(theme).id, scheme: s === 'auto' ? null : s };
}

/** 지금 화면이 다크인가 — tokens.css 와 같은 판정. `data-scheme` 가 있으면 그것, 없으면 OS 설정. */
export function resolveDark(schemeAttr: string | null | undefined, osDark: boolean): boolean {
  if (schemeAttr === 'dark') return true;
  if (schemeAttr === 'light') return false;
  return osDark;
}
