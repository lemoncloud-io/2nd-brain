// 단계 띠. kind: project인 뷰어는 어느 페이지에서든 전체 단계와 현재 상태가 보여야 한다.
// 첫 stages 블록을 기준으로 삼는다 — 로드맵이 둘 이상이면 첫 번째가 전체 진행이다.
// parent를 쓴 단계가 있으면 최상위 단계를 첫 줄에 두고, 하위 단계는 그 아래 줄의 부모 묶음 틀에 넣는다(묶음 칩은 줄을 바꾼다).
// parent가 없으면 옛 띠와 DOM이 같다(tests/ui/stage-dom.test.ts가 지킨다).

import type { Bundle, Stage, StagesBlock } from '../../model/types.ts';
import { formatRoute } from '../app/router.ts';
import { statusLabel, statusMarks } from './StatusBadge.tsx';
import { groupStages, laneLabel, stageProgress, toneOf } from './flowlayout.ts';

export interface StripSource {
  pageId: string;
  block: StagesBlock;
}

export function findStageStrip(bundle: Bundle): StripSource | null {
  if (bundle.viewer.meta.kind !== 'project') return null;
  for (const page of bundle.viewer.pages) {
    for (const block of page.blocks) {
      if (block.type === 'stages') return { pageId: page.id, block };
    }
  }
  return null;
}

function Chip({
  bundle,
  pageId,
  stage,
  currentId,
  sub = false,
  tally,
}: {
  bundle: Bundle;
  pageId: string;
  stage: Stage;
  currentId: string | null;
  sub?: boolean;
  tally?: string;
}): React.ReactElement {
  const view = bundle.status[stage.id];
  const tone = toneOf(view);
  // 진행 중은 칩 테두리를 빛줄기가 돌고(점은 가만히), 폐기는 칩 글자 전체에 취소선(선언한 어휘만)
  const { pulse, struck } = statusMarks(view);
  return (
    <a
      className={`stagestrip__item stagestrip__item--${tone}${sub ? ' stagestrip__item--sub' : ''}${pulse ? ' stagestrip__item--pulse' : ''}${struck ? ' stagestrip__item--struck' : ''}`}
      href={formatRoute({ kind: 'page', pageId, itemId: stage.id })}
      aria-current={currentId === stage.id ? 'true' : undefined}
      title={statusLabel(view)}
    >
      <span
        className="stagestrip__dot"
        style={{ background: `var(--tone-${tone}-fg)`, borderColor: `var(--tone-${tone}-line)` }}
        aria-hidden="true"
      />
      <span>{stage.short ?? stage.title}</span>
      <span className="muted">{statusLabel(view)}</span>
      {tally ? <span className="stagestrip__tally">{tally}</span> : null}
    </a>
  );
}

/** parent가 있을 때: 첫 줄은 최상위 단계, 그 아래 줄마다 부모의 묶음 틀 하나 — 한 줄로 늘어 가로 스크롤이 생기지 않게. */
function NestedRows({
  bundle,
  strip,
  currentId,
}: {
  bundle: Bundle;
  strip: StripSource;
  currentId: string | null;
}): React.ReactElement {
  const groups = groupStages(strip.block.stages);
  return (
    <>
      <div className="stagestrip__row">
        {groups.map(({ stage, children }) => {
          const progress = stageProgress(stage, children, bundle.status);
          // 자기 항목이 없는 부모는 하위 단계가 몇 개 끝났는지를 칩에 붙인다
          const tally = progress.from === 'children' ? `${progress.done}/${progress.total}` : undefined;
          return (
            <Chip
              key={stage.id}
              bundle={bundle}
              pageId={strip.pageId}
              stage={stage}
              currentId={currentId}
              {...(tally ? { tally } : {})}
            />
          );
        })}
      </div>
      {groups
        .filter(({ children }) => children.length > 0)
        .map(({ stage, children }) => {
          const label = laneLabel(stage);
          return (
            <div
              className={`stagestrip__group stagestrip__group--${toneOf(bundle.status[stage.id])}`}
              role="group"
              aria-label={label}
              key={`${stage.id}:group`}
            >
              <span className="stagestrip__arrow" aria-hidden="true">
                ↳
              </span>
              <span className="stagestrip__groupLabel" aria-hidden="true">
                {label}
              </span>
              {children.map((child) => (
                <Chip key={child.id} bundle={bundle} pageId={strip.pageId} stage={child} currentId={currentId} sub />
              ))}
            </div>
          );
        })}
    </>
  );
}

export function StageStrip({
  bundle,
  strip,
  currentId,
}: {
  bundle: Bundle;
  strip: StripSource;
  currentId: string | null;
}): React.ReactElement {
  const nested = strip.block.stages.some((s) => s.parent !== undefined);
  return (
    <nav className="stagestrip" aria-label="단계">
      <span className="stagestrip__label">단계</span>
      <div className={nested ? 'stagestrip__list stagestrip__list--nested' : 'stagestrip__list'}>
        {nested ? (
          <NestedRows bundle={bundle} strip={strip} currentId={currentId} />
        ) : (
          strip.block.stages.map((stage) => (
            <Chip key={stage.id} bundle={bundle} pageId={strip.pageId} stage={stage} currentId={currentId} />
          ))
        )}
      </div>
    </nav>
  );
}
