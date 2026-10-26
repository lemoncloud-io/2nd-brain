// 오른쪽 열 패널의 제목. 접기·펴기 단추이고, 캐럿 → 아이콘 → 제목 순으로 그린다.
import { createElement } from 'react';

import type { Panel } from './registry.ts';

export function PanelHeading({ panel, collapsed, onToggle }: { panel: Panel; collapsed: boolean; onToggle: () => void }) {
  return (
    <h3>
      <button type="button" className="panel-toggle" aria-expanded={!collapsed} onClick={onToggle}>
        <span className="panel-caret">{collapsed ? '▸' : '▾'}</span>
        <span className="panel-icon">{createElement(panel.icon, { size: 14 })}</span>
        {panel.title}
      </button>
    </h3>
  );
}
