import { prBadgeHead, prBadgeText, prHeadLag, prTooltip } from './source-ui.ts';
import type { PrChanges } from './types.ts';

type Props = {
  changes: PrChanges;
  /** 오른쪽 열의 PR 상세 패널로 간다. 에이전트 모드(agent)면 쓰지 않는다. */
  onClick: () => void;
  /** 에이전트 모드: 누를 곳이 없으니 단추가 아니라 글이다. */
  agent?: boolean;
};

/**
 * 상단 오른쪽 귀퉁이의 PR 배지: 지금 어느 커밋을 읽는지 크게. `PR #n · <제목> @ <읽은 커밋 7자>`.
 * 머리는 gh 의 headOid 가 아니라 실제로 읽은 커밋(headCommit)이다 — 다르면 `PR 머리 미반영` 을 붙인다.
 * 툴팁은 작성자·브랜치·머리. 머리는 글로도 싣는다 — 에이전트 모드엔 툴팁·오른쪽 열이 없다.
 */
export function PrBadge({ changes, onClick, agent = false }: Props) {
  const attrs = { className: 'pr-badge', title: prTooltip(changes), 'data-pr': String(changes.number), 'data-head': changes.headCommit };
  const lag = prHeadLag(changes);
  const body = (
    <>
      <span className="pr-badge-title">{prBadgeText(changes)}</span>
      <span className="pr-badge-head">@ {prBadgeHead(changes)}</span>
      {lag === null ? null : (
        <span className="pr-head-lag" title={lag.title}>
          {lag.text}
        </span>
      )}
    </>
  );
  if (agent) return <span {...attrs}>{body}</span>;
  return (
    <button type="button" {...attrs} onClick={onClick}>
      {body}
    </button>
  );
}
