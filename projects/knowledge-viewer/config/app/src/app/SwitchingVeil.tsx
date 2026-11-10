// 소스 바꾸는 중 표시: 상단바 아래 가는 막대 + 가운데 열을 흐리는 덮개(가운데 작은 회전 표시와 글).
// 둘 다 격자 칸(top·center)에 겹쳐 그린다 — 열 안에 두면 스크롤과 같이 움직인다. 모양은 styles/switching.css.
// delayMs 뒤에야 켠다(빠른 전환은 깜빡이지 않는다). 켜진 동안 새 전환이 오면 글만 바뀐다.
// 알림(role=status)은 늘 있고 글만 채운다 — 새로 붙는 live 영역은 읽히지 않을 수 있다.
import { useEffect, useState } from 'react';

import { SWITCH_SHOW_DELAY_MS, type Switching } from './source-switch.ts';

export function SwitchingVeil({ active, delayMs = SWITCH_SHOW_DELAY_MS }: { active: Switching | null; delayMs?: number }) {
  const busy = active !== null;
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!busy) {
      setLate(false);
      return;
    }
    if (delayMs <= 0) return;
    const t = setTimeout(() => setLate(true), delayMs);
    return () => clearTimeout(t);
  }, [busy, delayMs]);
  const on = active !== null && (delayMs <= 0 || late);
  return (
    <>
      <div className="switching-bar" data-on={on ? 'true' : 'false'} aria-hidden="true" />
      <div className="switching-veil" data-on={on ? 'true' : 'false'}>
        <div className="switching-box">
          {on ? <span className="switching-spinner" aria-hidden="true" /> : null}
          <span className="switching-label" role="status" aria-live="polite">
            {on ? active.label : ''}
          </span>
        </div>
      </div>
    </>
  );
}
