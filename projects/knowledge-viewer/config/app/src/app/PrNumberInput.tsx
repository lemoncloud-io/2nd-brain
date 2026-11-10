// ⚙ 소스 줄의 PR 번호 칸. 번호를 치고 Enter(또는 "열기")면 그 PR 이 있는지 묻고 옮긴다. 판정은 pr-number.ts.
import { useRef, useState } from 'react';

import { getPrChanges } from './api.ts';
import { submitPrNumber } from './pr-number.ts';

type Props = {
  onEnterPr: (n: number) => void;
  /** 그 PR 이 있는가(없으면 던진다). 시험이 가짜를 준다. 기본은 변경 목록 요청. */
  check?: (n: number) => Promise<unknown>;
};

export function PrNumberInput({ onEnterPr, check = getPrChanges }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // 늦게 온 옛 응답은 버린다(묻는 사이 다시 치거나 다시 눌렀다).
  const seq = useRef(0);
  return (
    <>
      <form
        className="pr-number"
        onSubmit={(e) => {
          e.preventDefault();
          const mine = ++seq.current;
          setBusy(true);
          setMessage(null);
          void submitPrNumber(text, { check, go: onEnterPr }).then((r) => {
            if (mine !== seq.current) return;
            setBusy(false);
            if (r.ok) setText('');
            else setMessage(r.message);
          });
        }}
      >
        <input
          className="pr-number-input"
          inputMode="numeric"
          placeholder="PR #"
          aria-label="PR 번호"
          value={text}
          onChange={(e) => {
            seq.current++;
            setBusy(false);
            setText(e.target.value);
            setMessage(null);
          }}
        />
        <button type="submit" className="settings-link" disabled={busy}>
          {busy ? '확인 중…' : '열기'}
        </button>
      </form>
      {message !== null ? (
        <p className="settings-note" role="status">
          {message}
        </p>
      ) : null}
    </>
  );
}
