// mermaid 기본 테마 그대로. 되돌림용 — 라이트는 default, 다크는 dark.
import type { MermaidTheme } from './types.ts';

export const classic: MermaidTheme = {
  id: 'classic',
  title: '클래식',
  description: 'mermaid 기본 테마 그대로. 다른 도구와 같은 모양으로 볼 때.',
  init: (dark) => ({ theme: dark ? 'dark' : 'default' }),
};
