// 다이어그램 테마 선택. 어디에든 꽂을 수 있다 — 지금은 ⚙ 설정 메뉴(compact), 긴 꼴은 라벨·설명 줄이 붙는다.
// value·onChange 를 주지 않으면 저장소(mermaid-theme-prefs)를 직접 읽고 쓴다.
import { useId } from 'react';

import { useMermaidTheme, writeMermaidTheme } from './mermaid-theme-prefs.ts';
import { findMermaidTheme, MERMAID_THEMES } from './mermaid-themes/registry.ts';

export type MermaidThemeSelectProps = {
  value?: string;
  onChange?: (id: string) => void;
  /** 압축 꼴(⚙ 메뉴): 라벨·설명 줄 없이 select 하나, 설명은 title. */
  compact?: boolean;
};

export function MermaidThemeSelect({ value, onChange, compact = false }: MermaidThemeSelectProps) {
  const stored = useMermaidTheme();
  const id = findMermaidTheme(value ?? stored).id;
  const labelId = useId();
  const selected = findMermaidTheme(id);
  if (compact)
    return (
      <select
        id={`${labelId}-select`}
        className="mermaid-theme-select"
        aria-label="다이어그램 테마"
        title={selected.description}
        value={id}
        onChange={(e) => (onChange ?? writeMermaidTheme)(e.target.value)}
      >
        {MERMAID_THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>
    );
  return (
    <div className="mermaid-theme-row">
      <label id={labelId} htmlFor={`${labelId}-select`}>
        다이어그램 테마
      </label>
      <select
        id={`${labelId}-select`}
        className="mermaid-theme-select"
        value={id}
        onChange={(e) => (onChange ?? writeMermaidTheme)(e.target.value)}
      >
        {MERMAID_THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>
      <p className="mermaid-theme-desc">{selected.description}</p>
    </div>
  );
}
