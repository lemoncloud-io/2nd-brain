// 상태 배지. 색(tone)만으로 뜻을 전하지 않고 항상 글자를 함께 둔다.
// 어휘가 motion: pulse(진행 중)·struck: true(폐기)를 선언했을 때만 장식이 붙는다. 선언하지 않은 뷰어는 DOM이 그대로다.

import type { StatusView, Tone } from '../../model/types.ts';

const NO_ORIGIN = '상태 근거 미등록';

export function toneClass(tone: Tone): string {
  return `badge badge--${tone}`;
}

export function statusLabel(view: StatusView | undefined): string {
  if (!view) return NO_ORIGIN;
  return view.origin === 'none' ? NO_ORIGIN : view.label;
}

/** 어휘가 선언한 표시 장식. 상태 근거가 없으면(origin: none) 장식도 없다. */
export function statusMarks(view: StatusView | undefined): { pulse: boolean; struck: boolean } {
  if (!view || view.origin === 'none') return { pulse: false, struck: false };
  return { pulse: view.motion === 'pulse', struck: view.struck === true };
}

/** 폐기된 단계·항목의 제목에 취소선을 긋는다. 폐기가 아니면 감싸지 않는다(DOM 그대로). */
export function Struck({ on, children }: { on: boolean; children: React.ReactNode }): React.ReactElement {
  return on ? <span className="strike">{children}</span> : <>{children}</>;
}

export function StatusBadge({
  view,
  showNote = false,
}: {
  view: StatusView | undefined;
  showNote?: boolean;
}): React.ReactElement {
  const tone: Tone = view?.origin === 'none' ? 'muted' : view?.tone ?? 'muted';
  const { pulse, struck } = statusMarks(view);
  return (
    <span className={`${toneClass(tone)}${pulse ? ' badge--pulse' : ''}${struck ? ' badge--struck' : ''}`}>
      {/* 취소선은 상태 이름에만 — 메모까지 그으면 읽기 어렵다 */}
      {struck ? <span className="strike">{statusLabel(view)}</span> : statusLabel(view)}
      {/* 기본값을 받은 상태는 그렇게 밝힌다 — 안 본 것과 본 것이 같아 보이면 안 된다 */}
      {view?.origin === 'ledger-default' ? <span className="badge__note">기본값</span> : null}
      {showNote && view?.note ? <span className="badge__note">{view.note}</span> : null}
    </span>
  );
}
