// 패널 켜기·순서 목록. 순수 로직은 prefs.ts 에 있고 여기는 그 함수를 부르기만 한다.
// 2026-10-24 ⚙ 설정 메뉴의 "패널" 절로 옮겼다(전에는 오른쪽 열 맨 위 "패널 설정" 단추). 접힘은 패널 제목에서 바꾼다.
import { movePanel, togglePanel, type PanelPrefs } from './prefs.ts';
import type { Panel } from './registry.ts';

export type PanelSettingsProps = { panels: Panel[]; prefs: PanelPrefs; onChange: (p: PanelPrefs) => void };

export function PanelSettings({ panels, prefs, onChange }: PanelSettingsProps) {
  const byId = new Map(panels.map((p) => [p.id, p]));
  const last = prefs.order.length - 1;
  return (
    <ul className="panel-settings-list" aria-label="패널 켜기·순서">
      {prefs.order.map((id, i) => {
        const p = byId.get(id);
        if (!p) return null;
        const on = !prefs.off.includes(id);
        return (
          <li key={id}>
            <label>
              <input type="checkbox" checked={on} onChange={() => onChange(togglePanel(prefs, id))} />
              <span>{p.title}</span>
            </label>
            <button type="button" aria-label={`${p.title} 위로`} disabled={i === 0} onClick={() => onChange(movePanel(prefs, id, -1))}>
              ▲
            </button>
            <button type="button" aria-label={`${p.title} 아래로`} disabled={i === last} onClick={() => onChange(movePanel(prefs, id, 1))}>
              ▼
            </button>
          </li>
        );
      })}
    </ul>
  );
}
