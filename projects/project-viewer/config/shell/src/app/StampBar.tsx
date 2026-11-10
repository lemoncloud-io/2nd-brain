// 빌드 스탬프. 전부 빌드가 찍은 값이다 — 손으로 쓰는 날짜는 없다(F6).
// 경고 수가 0이 아니면 눌러서 실제 목록을 펼친다. 숫자만 보여 주고 끝내면 아무도 확인하지 않는다.
// 넓은 화면(901px~)은 본문 왼쪽의 좁은 아이콘 레일, 좁은 화면은 하단 띠다(모양은 layout.css가 가른다).
// 레일에는 글자를 두지 않는다 — 해시·시각은 아이콘만, 개수는 아이콘 + 숫자. 이름·전체 값은 마우스를 올리거나
// 포커스하면 레일 오른쪽에 뜨는 말풍선(.stampbar__tip)과 aria-label이 보여 준다.

import { useCallback, useEffect, useState } from 'react';

import type { Bundle } from '../../model/types.ts';

// 16px 선 아이콘의 획. 바깥 아이콘 의존성 없이 직접 그린다(색은 currentColor). 아이콘만으로 뜻이 갈리게 모양을 서로 다르게 둔다.
const ICON_PATHS = {
  // 빌드 시각 — 시계
  clock: 'M8 1.75a6.25 6.25 0 1 0 0 12.5a6.25 6.25 0 1 0 0-12.5M8 4.5V8l2.5 1.5',
  // 커밋 — 선 위의 점(git-commit)
  commit: 'M8 5.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5M1 8h4.5M10.5 8H15',
  // 문서 수 — 겹친 문서(file-stack)
  fileStack: 'M6 1.5h5l3 3v7.5M2 4.5h6l3 3v7H2zM8 4.5v3h3',
  // yml 해시 — 코드 문서(file-code)
  fileCode: 'M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3M6.75 8.25L5.25 9.75l1.5 1.5M9.25 8.25l1.5 1.5-1.5 1.5',
  // 원장 해시 — 장부(책)
  ledger: 'M4 1.5h8.5v10H4A1.5 1.5 0 0 0 2.5 13V3A1.5 1.5 0 0 1 4 1.5zM2.5 13A1.5 1.5 0 0 0 4 14.5h8.5v-3M5.5 4.5h4.5M5.5 7h4.5',
  // 범위 밖 링크 — 바깥으로 나가는 링크(link-external)
  linkExternal: 'M12.5 9v3.5a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1H7M10 2.5h3.5V6M13.5 2.5L7.5 8.5',
  // 참고 원본 누락 — X 친 문서(file-x)
  fileX: 'M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3M6.5 8l3 3M9.5 8l-3 3',
  // 미확인 코드 근거 — 물음표 낀 코드 괄호
  codeQuestion: 'M4.5 4.5L1.5 8l3 3.5M11.5 4.5l3 3.5-3 3.5M6.6 6.3a1.5 1.5 0 1 1 2.1 1.4c-.45.25-.7.55-.7 1.1M8 10.9v.2',
  // 물려받은 근거 — 선으로 내려받는 화살표(arrow-down-to-line)
  arrowDownToLine: 'M8 1.5v9M4.5 7L8 10.5 11.5 7M3 14h10',
  // 경고 전체 — 경고 삼각형
  alert: 'M8 2l6.5 11.5h-13zM8 6.5v3M8 11.6v.1',
} as const;

type IconName = keyof typeof ICON_PATHS;

/** 레일·띠 공용 16px 아이콘. 읽는 이에게는 숨긴다(이름은 aria-label이 맡는다). */
function Icon({ name }: { name: IconName }): React.ReactElement {
  return (
    <svg
      className="stampbar__icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/** 빌드 시각(로컬) "YYYY-MM-DD HH:mm". 읽지 못하면 원문 그대로. */
function formatBuiltAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const WARN_LABEL: { key: keyof Bundle['stamp']['counts']; label: string; codes: string[]; icon: IconName }[] = [
  { key: 'unresolvedLinks', label: '범위 밖 링크', codes: ['W_LINK_UNRESOLVED'], icon: 'linkExternal' },
  { key: 'missingReferences', label: '참고 원본 누락', codes: ['W_REFERENCE_MISSING'], icon: 'fileX' },
  { key: 'unverifiedCode', label: '미확인 코드 근거', codes: ['W_CODE_UNVERIFIED'], icon: 'codeQuestion' },
  { key: 'inheritedEvidence', label: '물려받은 근거', codes: ['W_INHERITED'], icon: 'arrowDownToLine' },
];

/** 정보 한 칸 — 포커스되는 그림(role=img). 띠에서는 이름·값 글자가 보이고, 레일에서는 text 값이 숨고 count 값만 남는다. */
function Item({
  icon,
  label,
  tip,
  kind,
  className = '',
  children,
}: {
  icon: IconName;
  label: string;
  tip: string;
  kind: 'text' | 'count';
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <span className={`stampbar__item ${className}`.trim()} tabIndex={0} role="img" aria-label={tip} data-tip={tip}>
      <Icon name={icon} />
      <span className="stampbar__label">{label}</span>
      <span className={`stampbar__value stampbar__value--${kind}`}>{children}</span>
    </span>
  );
}

/** 펼친 경고 목록. 무엇을 펼쳤는지(label)와 닫기 단추를 머리에 둔다. */
export function StampIssues({
  label,
  issues,
  onClose,
}: {
  label: string;
  issues: Bundle['issues'];
  onClose: () => void;
}): React.ReactElement {
  return (
    <div className="stampbar__issues" role="region" aria-label={`${label} 목록`}>
      <div className="stampbar__issuesHead">
        <strong>{label}</strong>
        <button type="button" className="btn stampbar__close" onClick={onClose}>
          닫기
        </button>
      </div>
      {issues.length === 0 ? (
        <div className="muted">이 종류로 기록된 경고 항목이 없다(집계 수만 있다).</div>
      ) : (
        issues.map((issue, i) => (
          <div className="stampbar__issue" key={i}>
            <code>{issue.code}</code>
            <span>{issue.message}</span>
            <code className="muted">{issue.where}</code>
          </div>
        ))
      )}
    </div>
  );
}

export function StampBar({ bundle }: { bundle: Bundle }): React.ReactElement {
  const [open, setOpen] = useState<string | null>(null);
  // 말풍선 — 글과 세로 위치(.app 기준, 칸 가운데)
  const [tip, setTip] = useState<{ text: string; top: number } | null>(null);
  const stamp = bundle.stamp;
  const shown = open === null ? [] : bundle.issues.filter((i) => open === 'all' || i.code === open);
  const builtAt = formatBuiltAt(stamp.builtAt);
  const commit = stamp.commit ? stamp.commit.slice(0, 7) : '없음';
  const commitTip = `커밋 · ${stamp.commit ?? '없음'}${stamp.dirty ? ' (dirty — 커밋 안 된 변경 포함)' : ''}`;
  const openLabel = open === 'all' ? '경고 전체' : WARN_LABEL.find((w) => w.codes[0] === open)?.label ?? open ?? '';

  // 펼친 경고 목록·말풍선은 Esc로 닫는다(레일 옆 창이 본문을 덮으므로).
  useEffect(() => {
    if (open === null && tip === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setTip(null);
      setOpen(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, tip]);

  // 마우스·포커스가 닿은 칸(data-tip)의 말풍선을 그 칸 높이에 띄운다. 좁은 화면에서는 CSS가 숨긴다.
  const showTip = useCallback((target: EventTarget | null) => {
    const el = target instanceof Element ? target.closest<HTMLElement>('[data-tip]') : null;
    const app = el?.closest('.app');
    if (!el || !app) {
      setTip(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setTip({ text: el.dataset.tip ?? '', top: r.top - app.getBoundingClientRect().top + r.height / 2 });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);

  return (
    <footer className="stampbar" aria-label="빌드 스탬프">
      <div
        className="stampbar__row"
        onPointerOver={(e) => showTip(e.target)}
        onPointerLeave={hideTip}
        onFocus={(e) => showTip(e.target)}
        onBlur={hideTip}
      >
        {/* 위 묶음: 빌드가 찍은 값 — 레일에서는 아이콘만(문서 수는 숫자도) */}
        <div className="stampbar__group">
          <Item icon="clock" label="빌드" kind="text" tip={`빌드 · ${builtAt}`}>
            <span className="nums">{builtAt}</span>
          </Item>
          <Item
            icon="commit"
            label="커밋"
            kind="text"
            tip={commitTip}
            className={stamp.dirty ? 'stampbar__item--dirty' : ''}
          >
            <code className="nums">{commit}</code>
            {stamp.dirty ? <span className="badge badge--amber">dirty</span> : null}
          </Item>
          <Item icon="fileStack" label="문서" kind="count" tip={`문서 ${stamp.docCount}개`}>
            <span className="nums">{stamp.docCount}</span>
          </Item>
          <Item icon="fileCode" label="yml" kind="text" tip={`yml 해시 · ${stamp.ymlDigest}`}>
            <code>{stamp.ymlDigest}</code>
          </Item>
          {stamp.ledgerDigest ? (
            <Item icon="ledger" label="원장" kind="text" tip={`원장 해시 · ${stamp.ledgerDigest}`}>
              <code>{stamp.ledgerDigest}</code>
            </Item>
          ) : null}
        </div>

        {/* 아래 묶음: 경고 칩 — 아이콘 + 숫자. 0이 아니면 눌러 목록을 펼친다 */}
        <div className="stampbar__group stampbar__group--warn">
          {WARN_LABEL.map(({ key, label, codes, icon }) => {
            const count = stamp.counts[key];
            const code = codes[0]!;
            if (count === 0) {
              return (
                <span
                  className="stampbar__warn stampbar__warn--zero"
                  key={key}
                  tabIndex={0}
                  role="img"
                  aria-label={`${label} 0건`}
                  data-tip={`${label} 0건`}
                >
                  <Icon name={icon} />
                  <span className="stampbar__label">{label}</span> <span className="nums">0</span>
                </span>
              );
            }
            return (
              <button
                type="button"
                className="stampbar__warn stampbar__warn--hot"
                key={key}
                aria-label={`${label} ${count}건`}
                data-tip={`${label} ${count}건 · 눌러서 목록`}
                aria-expanded={open === code}
                onClick={() => setOpen(open === code ? null : code)}
              >
                <Icon name={icon} />
                <span className="stampbar__label">{label}</span> <span className="nums">{count}</span>
              </button>
            );
          })}

          {bundle.issues.length > 0 ? (
            <button
              type="button"
              className="stampbar__warn"
              aria-label={`경고 전체 ${bundle.issues.length}건`}
              data-tip={`경고 전체 ${bundle.issues.length}건 · 눌러서 목록`}
              aria-expanded={open === 'all'}
              onClick={() => setOpen(open === 'all' ? null : 'all')}
            >
              <Icon name="alert" />
              <span className="stampbar__label">경고 전체</span> <span className="nums">{bundle.issues.length}</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* 말풍선 — 레일 오른쪽, 가리킨 칸 높이. 내용은 aria-label과 같아 읽는 이에게는 숨긴다 */}
      {tip !== null ? (
        <div className="stampbar__tip" aria-hidden="true" style={{ top: `${tip.top}px` }}>
          {tip.text}
        </div>
      ) : null}

      {/* 펼친 경고 목록 — 넓은 화면은 레일 오른쪽에 뜨는 창, 좁은 화면은 띠 위로 펼친다 */}
      {open !== null ? <StampIssues label={openLabel} issues={shown} onClose={() => setOpen(null)} /> : null}
    </footer>
  );
}
