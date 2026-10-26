// 화면 테마 고르기: 테마 선택 상자 + 밝기 라디오(자동·라이트·다크). ⚙ 설정 메뉴의 "테마" 절에 꽂힌다.
// value·onTheme·onScheme 를 주지 않으면 저장소(theme-apply)를 직접 읽고 쓴다. 바꾸면 즉시 적용된다.
import { useId } from 'react';

import { setScheme, setTheme, useThemePrefs } from './theme-apply.ts';
import { findTheme, isScheme, SCHEMES, THEMES, type Scheme } from './themes.ts';

const SCHEME_LABEL: Record<Scheme, string> = { auto: '자동', light: '라이트', dark: '다크' };

export type ThemeSelectProps = {
  value?: { theme: string; scheme: Scheme };
  onTheme?: (id: string) => void;
  onScheme?: (s: Scheme) => void;
  /** 압축 꼴(⚙ 메뉴): 설명 줄 대신 select 의 title, 밝기는 라디오 대신 세 칸 토글. */
  compact?: boolean;
};

export function ThemeSelect({ value, onTheme, onScheme, compact = false }: ThemeSelectProps) {
  const stored = useThemePrefs();
  const cur = value ?? stored;
  const theme = findTheme(cur.theme);
  const id = useId();
  const pick = (s: Scheme) => (onScheme ?? setScheme)(s);
  if (compact) {
    const desc = `${theme.variants}${theme.source !== null ? ` · ${theme.source}` : ''}`;
    return (
      <div className="theme-row theme-row-compact">
        <select
          id={`${id}-theme`}
          className="theme-select"
          aria-label="화면 테마"
          title={desc}
          value={theme.id}
          onChange={(e) => (onTheme ?? setTheme)(e.target.value)}
        >
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        <div className="seg" role="radiogroup" aria-label="밝기">
          {SCHEMES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={cur.scheme === s}
              className={cur.scheme === s ? 'seg-btn seg-on' : 'seg-btn'}
              onClick={() => pick(s)}
            >
              {SCHEME_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="theme-row">
      <label htmlFor={`${id}-theme`}>화면 테마</label>
      <select id={`${id}-theme`} className="theme-select" value={theme.id} onChange={(e) => (onTheme ?? setTheme)(e.target.value)}>
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>
      <p className="theme-desc">
        {theme.variants}
        {theme.source !== null ? (
          <>
            {' · '}
            <a href={theme.source} target="_blank" rel="noreferrer noopener">
              출처
            </a>
          </>
        ) : null}
      </p>
      <div className="theme-scheme" role="radiogroup" aria-label="밝기">
        {SCHEMES.map((s) => (
          <label key={s} className="settings-row">
            <input
              type="radio"
              name={`${id}-scheme`}
              value={s}
              checked={cur.scheme === s}
              onChange={(e) => {
                if (e.target.checked && isScheme(e.target.value)) pick(e.target.value);
              }}
            />
            <span>{SCHEME_LABEL[s]}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
