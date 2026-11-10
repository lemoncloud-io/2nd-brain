// 본문 위의 메타 카드. "원문 그대로"임을 먼저 밝히고, 이 문서를 근거로 쓰는 항목을 되짚어 준다
// (해설 → 원본 한 방향만 보이면 원본이 얼마나 쓰이는지 알 수 없다).

import { useState } from 'react';

import type { BackRef, Bundle, SourceDoc } from '../../model/types.ts';
import { formatRoute } from '../app/router.ts';
import type { Route } from '../app/router.ts';

// 역링크가 수십 개인 문서가 있다. 다 펼치면 본문이 한 화면 아래로 밀린다.
const BACKLINK_FOLD = 8;

const KIND_LABEL: Record<BackRef['kind'], string> = {
  glossary: '용어',
  node: '노드',
  step: '스텝',
  stage: '단계',
  item: '항목',
  row: '행',
  block: '블록',
};

function backRoute(ref: BackRef): Route | null {
  if (ref.kind === 'glossary') return { kind: 'glossary', termId: ref.id };
  if (ref.page === undefined) return null;
  return { kind: 'page', pageId: ref.page, itemId: ref.id };
}

function frontmatterText(doc: SourceDoc, key: string): string | null {
  const value = doc.frontmatter[key];
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function MetaCard({ bundle, doc }: { bundle: Bundle; doc: SourceDoc }): React.ReactElement {
  const backlinks = bundle.backlinks[doc.id] ?? [];
  const status = frontmatterText(doc, 'status');
  const updated = frontmatterText(doc, 'updated');
  const [expanded, setExpanded] = useState(false);

  const folded = backlinks.length > BACKLINK_FOLD && !expanded;
  const shown = folded ? backlinks.slice(0, BACKLINK_FOLD) : backlinks;
  const rest = backlinks.length - BACKLINK_FOLD;

  return (
    <section className="meta-card">
      <div className="meta-card__row">
        <span className="badge badge--verbatim">원문 그대로</span>
        <code className="meta-card__path">{doc.path}</code>
      </div>

      <dl className="meta-card__facts">
        {status !== null ? (
          <>
            <dt>frontmatter 상태</dt>
            <dd>{status}</dd>
          </>
        ) : null}
        {updated !== null ? (
          <>
            <dt>갱신</dt>
            <dd>{updated}</dd>
          </>
        ) : null}
        <dt>지문</dt>
        <dd>
          <code>{doc.digest === '' ? '—' : doc.digest}</code>
        </dd>
        <dt>이 문서를 근거로 쓰는 항목</dt>
        <dd>{backlinks.length}개</dd>
      </dl>

      {backlinks.length > 0 ? (
        <ul className="meta-card__backlinks" id={`backlinks-${doc.id}`}>
          {shown.map((ref) => {
            const route = backRoute(ref);
            const label = `${KIND_LABEL[ref.kind]} · ${ref.label}`;
            return (
              <li key={`${ref.kind}:${ref.id}`}>
                {route === null ? (
                  <span className="muted">{label}</span>
                ) : (
                  <a href={formatRoute(route)}>{label}</a>
                )}
              </li>
            );
          })}
          {backlinks.length > BACKLINK_FOLD ? (
            <li>
              <button
                type="button"
                className="meta-card__more"
                aria-expanded={expanded}
                aria-controls={`backlinks-${doc.id}`}
                onClick={() => setExpanded((v) => !v)}
              >
                {folded ? `${rest}개 더 보기` : '접기'}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
