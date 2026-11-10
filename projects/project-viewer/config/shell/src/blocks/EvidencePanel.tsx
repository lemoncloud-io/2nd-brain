// 근거 패널. "상세 원문"(해설의 출처)과 "상태 출처"(단계·항목 상태의 출처)를 절대 섞지 않는다.
// 둘을 한 덩어리로 보여 주면 "상태가 검증됐다"와 "설명의 출처가 있다"를 구별할 수 없게 된다.

import type { Bundle, EvidenceRef, LedgerRef, StatusView } from '../../model/types.ts';
import type { EntityRecord } from '../app/entities.ts';
import { KIND_LABEL, refLabel, resolvedOf, sourceSpec } from '../app/entities.ts';
import { Inline } from '../app/inline.tsx';
import type { Route } from '../app/router.ts';
import { formatRoute } from '../app/router.ts';
import { StatusBadge } from './StatusBadge.tsx';

function docRoute(sourceId: string, slug?: string): Route {
  return slug === undefined ? { kind: 'docs', sourceId } : { kind: 'docs', sourceId, slug };
}

function RefButton({ bundle, refr }: { bundle: Bundle; refr: EvidenceRef }): React.ReactElement {
  const spec = sourceSpec(bundle, refr.source);
  const resolved = resolvedOf(refr);
  const name = refLabel(bundle, refr);

  // 볼트 밖 저장소의 코드는 본문을 내장하지 않는다. url_base가 있을 때만 외부 링크를 만든다.
  if (spec?.repo) {
    const coord = `${spec.repo} · ${spec.path}${refr.lines ? `:${refr.lines}` : ''}`;
    if (spec.url_base) {
      return (
        <a className="btn" href={`${spec.url_base}/${spec.path}`} target="_blank" rel="noreferrer">
          {name}
          <span className="muted">↗</span>
        </a>
      );
    }
    return (
      <span className="panel__coord" title="외부 주소가 등록되지 않아 좌표만 보여 준다">
        {coord}
      </span>
    );
  }

  return (
    <a className="btn" href={formatRoute(docRoute(refr.source, resolved?.slug))}>
      {name}
      {resolved && resolved.verified === false ? (
        <span className="muted">· 로컬에서 확인하지 못함</span>
      ) : null}
    </a>
  );
}

function StatusRefButton({ refr }: { refr: LedgerRef }): React.ReactElement {
  const resolved = (refr as { resolved?: { source?: string; slug?: string } }).resolved;
  const name = refr.label ?? `${refr.path}${refr.at ? ` › ${refr.at}` : ''}`;
  // 원장 증거가 sources에 등록된 원본이면 리더로 보내고, 아니면 경로만 보여 준다.
  if (resolved?.source) {
    return (
      <a className="btn" href={formatRoute(docRoute(resolved.source, resolved.slug))}>
        {name}
      </a>
    );
  }
  return <span className="panel__coord">{name}</span>;
}

const ORIGIN_LABEL: Record<StatusView['origin'], string> = {
  ledger: '상태 원장',
  'ledger-default': '상태 원장의 기본값',
  frontmatter: '단계 문서의 frontmatter',
  none: '없음 — 상태 근거 미등록',
};

export function EvidencePanel({
  bundle,
  entity,
  status,
  onClose,
}: {
  bundle: Bundle;
  entity: EntityRecord;
  status: StatusView | undefined;
  onClose: () => void;
}): React.ReactElement {
  const hasNarrative = entity.fields.length > 0;

  return (
    <aside className="panel" aria-label="근거">
      <div className="panel__head">
        <div>
          <div className="row">
            <span className="chip">{KIND_LABEL[entity.kind]}</span>
            {entity.tag ? <span className="chip">{entity.tag}</span> : null}
            {hasNarrative ? <span className="chip tag-derived">해설</span> : null}
          </div>
          <h3 className="panel__title">
            <Inline text={entity.title} refs={false} />
          </h3>
          {entity.pageTitle ? <div className="muted">{entity.pageTitle}</div> : null}
        </div>
        <button type="button" className="btn panel__close" onClick={onClose} aria-label="근거 패널 닫기">
          <span aria-hidden="true">×</span>
          닫기
        </button>
      </div>

      {hasNarrative ? (
        <div className="panel__section">
          <div className="panel__sectionTitle">해설</div>
          {entity.fields.map((field, i) => (
            <div className="panel__field" key={i}>
              <span className="panel__fieldLabel">{field.label}</span>
              <span>
                <Inline text={field.text} />
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {entity.hasStatus ? (
        <div className="panel__section">
          <div className="panel__sectionTitle">상태 출처</div>
          <div className="row">
            <StatusBadge view={status} showNote />
          </div>
          <div className="muted">{ORIGIN_LABEL[status?.origin ?? 'none']}</div>
          {status && status.evidence.length > 0 ? (
            <div className="panel__refs">
              {status.evidence.map((ref, i) => (
                <StatusRefButton key={i} refr={ref} />
              ))}
            </div>
          ) : (
            <div className="panel__empty">상태를 뒷받침하는 증거가 등록되어 있지 않다.</div>
          )}
        </div>
      ) : null}

      <div className="panel__section">
        <div className="panel__sectionTitle">
          상세 원문
          {entity.inherited ? <span className="chip tag-inherited"> 블록 근거</span> : null}
        </div>
        {entity.evidence.length > 0 ? (
          <div className="panel__refs">
            {entity.evidence.map((ref, i) => (
              <RefButton key={i} bundle={bundle} refr={ref} />
            ))}
          </div>
        ) : (
          <div className="panel__empty">이 항목에 걸린 원문이 없다.</div>
        )}
        {entity.inherited ? (
          <div className="muted">이 항목의 근거는 블록 전체에 걸린 것이다(항목별로 확인한 것이 아니다).</div>
        ) : null}
      </div>
    </aside>
  );
}
