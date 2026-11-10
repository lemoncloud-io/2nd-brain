// app/theme.ts 의 통합 보기 판. 같은 이름(useTheme·THEME_LABEL·ThemeChoice)을 내보낸다.
// 밝기는 바깥 앱(볼트 뷰어)의 것을 따른다. <html> 속성을 건드리지 않고, 고르기는 바깥 앱이 한다(셸 테마 단추는 embed.css 가 숨긴다).
import { THEME_LABEL } from '../app/theme.ts';
import type { ThemeChoice } from '../app/theme.ts';
import { embedHost } from './host.ts';

export { THEME_LABEL };
export type { ThemeChoice };

// 바깥 앱의 밝기를 그대로 돌려준다. 바꾸기는 하지 않는다.
const noop = (): void => {};

export function useTheme(): { theme: ThemeChoice; cycle: () => void } {
  return { theme: embedHost().theme, cycle: noop };
}
