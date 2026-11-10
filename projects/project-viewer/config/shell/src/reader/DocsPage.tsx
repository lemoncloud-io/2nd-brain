// 원본 리더. 왼쪽 내비게이터 · 가운데 본문 · 오른쪽 목차의 3단이고,
// 좁은 화면에서는 한 단으로 접히며 양옆은 서랍이 된다.

import { useEffect, useMemo, useState } from 'react';

import type { Bundle, SourceDoc } from '../../model/types.ts';
import bundleData from '../bundle.ts';
import { formatRoute } from '../app/router.ts';
import { DocReader } from './DocReader.tsx';
import { MetaCard } from './MetaCard.tsx';
import { Navigator, groupDocs } from './Navigator.tsx';
import { Toc } from './Toc.tsx';

import '../styles/reader.css';

const bundle: Bundle = bundleData;
const LINE_ANCHOR = /^L\d+$/;

function sourcePathMap(data: Bundle): Map<string, string> {
  const map = new Map<string, string>();
  // 볼트 밖 저장소의 코드는 경로 이름 공간이 달라 문서 링크의 대상이 될 수 없다.
  for (const spec of data.viewer.sources) if (spec.repo === undefined) map.set(spec.path, spec.id);
  return map;
}

function DocList({ data }: { data: Bundle }): React.ReactElement {
  return (
    <div className="doclist">
      <h2>원본</h2>
      <p className="muted">이 뷰어가 아는 원본의 전부다. 여기 없는 파일은 읽지 않는다.</p>
      {groupDocs(data).map(({ group, docs }) => (
        <section key={group}>
          <h3>{group}</h3>
          <ul className="doclist__items">
            {docs.map((doc) => (
              <li key={doc.id}>
                <a href={formatRoute({ kind: 'docs', sourceId: doc.id })}>{doc.title}</a>
                <code className="muted">{doc.path}</code>
                {doc.missing ? <span className="nav-item__flag">없음</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Breadcrumbs({ doc }: { doc: SourceDoc }): React.ReactElement {
  return (
    <nav className="reader__crumbs" aria-label="현재 위치">
      <a href={formatRoute({ kind: 'docs' })}>원본</a>
      {doc.group === undefined ? null : (
        <>
          <span aria-hidden="true">›</span>
          <span>{doc.group}</span>
        </>
      )}
      <span aria-hidden="true">›</span>
      <span className="reader__crumbs-here">{doc.title}</span>
    </nav>
  );
}

export function DocsPage(props: { sourceId?: string; slug?: string }): React.ReactElement {
  const { sourceId, slug } = props;
  const sourcePaths = useMemo(() => sourcePathMap(bundle), []);
  const [navOpen, setNavOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);

  // 문서를 옮기면 서랍은 닫는다 — 좁은 화면에서 서랍이 본문을 덮은 채 남지 않게.
  useEffect(() => {
    setNavOpen(false);
    setTocOpen(false);
  }, [sourceId, slug]);

  if (sourceId === undefined) return <DocList data={bundle} />;

  const doc = bundle.docs[sourceId];
  if (doc === undefined) {
    return (
      <div className="empty">
        그런 원본이 없다. <a href={formatRoute({ kind: 'docs' })}>원본 목록</a>으로 간다.
      </div>
    );
  }

  const known =
    slug === undefined || LINE_ANCHOR.test(slug) || doc.headings.some((h) => h.slug === slug);

  return (
    <div className={`reader${navOpen ? ' reader--nav-open' : ''}${tocOpen ? ' reader--toc-open' : ''}`}>
      <div className="reader__bar">
        <button type="button" className="btn reader__drawer-btn" onClick={() => setNavOpen((v) => !v)}>
          원본 목록
        </button>
        {doc.headings.length >= 4 ? (
          <button type="button" className="btn reader__drawer-btn" onClick={() => setTocOpen((v) => !v)}>
            목차
          </button>
        ) : null}
      </div>

      <aside className="reader__side reader__side--left">
        <Navigator bundle={bundle} currentId={doc.id} onNavigate={() => setNavOpen(false)} />
      </aside>

      <main className="reader__main">
        <Breadcrumbs doc={doc} />
        <h2 className="reader__title">{doc.title}</h2>
        <MetaCard bundle={bundle} doc={doc} />
        {known ? null : (
          <p className="notice" role="status">
            요청한 절을 찾지 못했습니다. 문서 맨 위를 보여 준다.
          </p>
        )}
        <DocReader
          doc={doc}
          sourcePaths={sourcePaths}
          {...(known && slug !== undefined ? { slug } : {})}
        />
      </main>

      <aside className="reader__side reader__side--right">
        <Toc headings={doc.headings} sourceId={doc.id} onNavigate={() => setTocOpen(false)} />
      </aside>
    </div>
  );
}
