// Mermaid 테마 등록부. 테마를 더하려면 이 폴더에 파일 하나와 MERMAID_THEMES 의 한 줄이다.
// 등록은 빌드 시(이 배열)이고, 고르기는 ../mermaid-theme-prefs.ts(localStorage)가 맡는다.
// id 는 설정 키다 — 한 번 정하면 바꾸지 않는다(src/panels/registry.ts 와 같은 계약).
import { classic } from './classic.ts';
import { mono } from './mono.ts';
import type { MermaidTheme } from './types.ts';
import { vault } from './vault.ts';

export type { MermaidTheme, ScreenPalette } from './types.ts';

export const MERMAID_THEMES: MermaidTheme[] = [vault, classic, mono];

/** 저장값이 없거나 모르는 id 일 때 쓰는 테마. */
export const DEFAULT_MERMAID_THEME = 'vault';

/** id 로 찾는다. 모르는 id 는 기본 테마다 — 테마를 빼도 저장된 설정이 깨지지 않는다. */
export function findMermaidTheme(id: string | null | undefined): MermaidTheme {
  return MERMAID_THEMES.find((t) => t.id === id) ?? MERMAID_THEMES.find((t) => t.id === DEFAULT_MERMAID_THEME) ?? MERMAID_THEMES[0]!;
}
