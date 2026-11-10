// stages 블록. 단계별 보기와 전체 항목 보기를 전환한다.
// 상태는 전부 bundle.status에서 읽는다 — viewer.yml에는 상태 값이 없다.
// parent·after를 쓴 블록만 맨 위에 흐름/목록 전환이 생기고 흐름이 기본이다. 안 쓴 블록은 옛 화면 그대로다.

import { useMemo, useState } from 'react';

import type { Bundle, Stage, StagesBlock, StatusView } from '../../model/types.ts';
import { Inline } from '../app/inline.tsx';
import { StageFlow } from './StageFlow.tsx';
import { StatusBadge, Struck, statusLabel, statusMarks } from './StatusBadge.tsx';
import { hasStageLinks } from './flowlayout.ts';

function tally(bundle: Bundle, stage: Stage): { done: number; total: number } {
  const items = stage.items ?? [];
  return {
    done: items.filter((i) => bundle.status[i.id]?.done === true).length,
    total: items.length,
  };
}

/** 폐기된 항목은 칸 전체를 속 빈 점선 칸으로 — 같은 회색의 미착수와 한눈에 갈리게. */
function pickClass(view: StatusView | undefined): string {
  return statusMarks(view).struck ? 'pick pick--struck' : 'pick';
}

function Meta({ label, text }: { label: string; text?: string }): React.ReactElement | null {
  if (!text) return null;
  return (
    <div className="stages__metaItem">
      <span className="stages__metaLabel">{label}</span>
      <span>
        <Inline text={text} />
      </span>
    </div>
  );
}

function StageDetail({
  bundle,
  stage,
  selectedId,
  onSelect,
}: {
  bundle: Bundle;
  stage: Stage;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const counts = tally(bundle, stage);
  return (
    <div className="stages__detail" id={stage.id}>
      <div className="row">
        <h4>
          <Struck on={statusMarks(bundle.status[stage.id]).struck}>
            <Inline text={stage.title} refs={false} />
          </Struck>
        </h4>
        <StatusBadge view={bundle.status[stage.id]} showNote />
        <button type="button" className="btn" onClick={() => onSelect(stage.id)}>
          근거 보기
        </button>
      </div>

      <div className="stages__meta">
        <Meta label="묻는 것" text={stage.question} />
        <Meta label="담당" text={stage.owner} />
        <Meta label="산출물" text={stage.output} />
        <Meta label="중단 조건" text={stage.stop} />
        {(stage.fields ?? []).map((field, i) => (
          <Meta key={i} label={field.label} text={field.text} />
        ))}
      </div>

      {counts.total > 0 ? (
        <>
          <div className="stages__tally">
            항목 {counts.done}/{counts.total} 통과
          </div>
          <div className="stages__items">
            {(stage.items ?? []).map((item) => (
              <button
                type="button"
                className={pickClass(bundle.status[item.id])}
                key={item.id}
                id={item.id}
                aria-current={selectedId === item.id ? 'true' : undefined}
                onClick={() => onSelect(item.id)}
              >
                <span className="pick__label">
                  <Struck on={statusMarks(bundle.status[item.id]).struck}>
                    <Inline text={item.label} refs={false} />
                  </Struck>
                  <StatusBadge view={bundle.status[item.id]} />
                  {item.required === false ? <span className="chip">선택</span> : null}
                </span>
                {item.criteria ? (
                  <span className="pick__body">
                    <Inline text={item.criteria} refs={false} />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="empty">이 단계에는 개별 항목이 없다.</div>
      )}
    </div>
  );
}

function AllItems({
  bundle,
  block,
  selectedId,
  onSelect,
}: {
  bundle: Bundle;
  block: StagesBlock;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const [stageFilter, setStageFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [text, setText] = useState('');

  const rows = useMemo(
    () =>
      block.stages.flatMap((stage) =>
        (stage.items ?? []).map((item) => ({ stage, item, view: bundle.status[item.id] })),
      ),
    [block, bundle],
  );

  const statuses = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) seen.set(statusLabel(row.view), statusLabel(row.view));
    return [...seen.keys()];
  }, [rows]);

  const needle = text.trim().toLowerCase();
  const shown = rows.filter(
    (row) =>
      (stageFilter === '' || row.stage.id === stageFilter) &&
      (statusFilter === '' || statusLabel(row.view) === statusFilter) &&
      (needle === '' ||
        row.item.label.toLowerCase().includes(needle) ||
        (row.item.criteria ?? '').toLowerCase().includes(needle)),
  );

  return (
    <div className="stack">
      <div className="filters">
        <select className="input" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} aria-label="단계 필터">
          <option value="">모든 단계</option>
          {block.stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.short ?? stage.title}
            </option>
          ))}
        </select>
        <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="상태 필터">
          <option value="">모든 상태</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          className="input"
          type="search"
          placeholder="항목 안에서 찾기"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="항목 텍스트 필터"
        />
        <span className="filters__count">
          {shown.length}/{rows.length}
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="empty">조건에 맞는 항목이 없다.</div>
      ) : (
        <div className="stages__items">
          {shown.map(({ stage, item, view }) => (
            <button
              type="button"
              className={pickClass(view)}
              key={item.id}
              aria-current={selectedId === item.id ? 'true' : undefined}
              onClick={() => onSelect(item.id)}
            >
              <span className="pick__label">
                <Struck on={statusMarks(view).struck}>
                  <Inline text={item.label} refs={false} />
                </Struck>
                <StatusBadge view={view} />
                <span className="chip">{stage.short ?? stage.title}</span>
              </span>
              {item.criteria ? (
                <span className="pick__body">
                  <Inline text={item.criteria} refs={false} />
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Stages({
  bundle,
  block,
  selectedId,
  onSelect,
}: {
  bundle: Bundle;
  block: StagesBlock;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const linked = hasStageLinks(block);
  const [view, setView] = useState<'flow' | 'list'>('flow');
  const [mode, setMode] = useState<'stage' | 'items'>('stage');
  const selectedStage =
    block.stages.find((s) => s.id === selectedId) ??
    block.stages.find((s) => (s.items ?? []).some((i) => i.id === selectedId)) ??
    // 흐름 보기는 아무것도 고르지 않았으면 지금 단계(끝나지 않은 첫 최상위 단계)를 연다
    (linked ? block.stages.find((s) => s.parent === undefined && bundle.status[s.id]?.done !== true) : undefined) ??
    block.stages[0];
  const [pinned, setPinned] = useState<string | null>(null);
  const current = block.stages.find((s) => s.id === pinned) ?? selectedStage;

  const list = (
    <>
      <div className="block__toolbar">
        <button
          type="button"
          className="btn"
          aria-pressed={mode === 'stage'}
          onClick={() => setMode('stage')}
        >
          단계별 보기
        </button>
        <button
          type="button"
          className="btn"
          aria-pressed={mode === 'items'}
          onClick={() => setMode('items')}
        >
          전체 항목 보기
        </button>
      </div>

      {mode === 'items' ? (
        <AllItems bundle={bundle} block={block} selectedId={selectedId} onSelect={onSelect} />
      ) : current ? (
        <div className="stages__grid">
          <div className="stages__list">
            {block.stages.map((stage) => {
              const counts = tally(bundle, stage);
              const { struck } = statusMarks(bundle.status[stage.id]);
              return (
                <button
                  type="button"
                  className={`${stage.parent === undefined ? 'stages__listBtn' : 'stages__listBtn stages__listBtn--child'}${struck ? ' stages__listBtn--struck' : ''}`}
                  key={stage.id}
                  aria-current={stage.id === current.id ? 'true' : undefined}
                  onClick={() => setPinned(stage.id)}
                >
                  <StatusBadge view={bundle.status[stage.id]} />
                  <span>
                    <Struck on={struck}>
                      <Inline text={stage.short ?? stage.title} refs={false} />
                    </Struck>
                  </span>
                  {counts.total > 0 ? (
                    <span className="stages__tally">
                      {counts.done}/{counts.total}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <StageDetail bundle={bundle} stage={current} selectedId={selectedId} onSelect={onSelect} />
        </div>
      ) : (
        <div className="empty">단계가 없다.</div>
      )}
    </>
  );

  if (!linked) return <div className="stages">{list}</div>;

  // 흐름에서 단계를 누르면 그 단계의 상세가 아래에 열리고 주소도 그 단계로 간다(띠와 같은 경로).
  // 고정(pinned)은 풀어 둔다 — 띠에서 다른 단계를 눌러도 상세가 따라가야 한다.
  const pick = (id: string) => {
    setPinned(null);
    if (selectedId !== id) onSelect(id);
  };
  return (
    <div className="stages">
      <div className="block__toolbar stages__views" role="group" aria-label="단계 보기 방식">
        <button type="button" className="btn" aria-pressed={view === 'flow'} onClick={() => setView('flow')}>
          흐름
        </button>
        <button type="button" className="btn" aria-pressed={view === 'list'} onClick={() => setView('list')}>
          목록
        </button>
      </div>
      {view === 'flow' ? (
        <>
          <StageFlow bundle={bundle} block={block} selectedId={current?.id ?? null} onPick={pick} />
          {current ? (
            <StageDetail bundle={bundle} stage={current} selectedId={selectedId} onSelect={onSelect} />
          ) : null}
        </>
      ) : (
        list
      )}
    </div>
  );
}
