// 앱 골격. 라우팅·선택·테마만 여기서 다루고 그리기는 blocks/와 reader/가 맡는다.

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Block, Bundle } from '../../model/types.ts';
import { BlockView } from '../blocks/BlockView.tsx';
import { EvidencePanel } from '../blocks/EvidencePanel.tsx';
import { GlossaryPage } from '../blocks/GlossaryPage.tsx';
import { StageStrip, findStageStrip } from '../blocks/StageStrip.tsx';
import { DocsPage } from '../reader/DocsPage.tsx';
import bundleData from '../bundle.ts';
import { buildEntityIndex } from './entities.ts';
import { InlineParagraphs, RefResolverContext } from './inline.tsx';
import { buildRefResolver } from './refs.ts';
import { SearchPage } from './SearchPage.tsx';
import { buildSearchIndex } from './search.ts';
import { StampBar } from './StampBar.tsx';
import { useTheme } from './theme.ts';
import { TopBar } from './TopBar.tsx';
import { scrollToId, useRoute } from './useRoute.ts';

const bundle: Bundle = bundleData;

// 탭 화면에서 선택된 항목이 어느 블록에 있는지 찾는다.
function blockHasId(block: Block, id: string): boolean {
  if (block.id === id) return true;
  switch (block.type) {
    case 'graph':
    case 'tree':
      return block.nodes.some((n) => n.id === id);
    case 'sequence':
      return block.steps.some((s) => s.id === id);
    case 'stages':
      return block.stages.some((s) => s.id === id || (s.items ?? []).some((i) => i.id === id));
    case 'items':
      return block.items.some((i) => i.id === id);
    case 'table':
      return block.rows.some((r) => r.id === id);
    default:
      return false;
  }
}

function PageView({
  bundle: data,
  pageId,
  selectedId,
  onSelect,
  labelOf,
}: {
  bundle: Bundle;
  pageId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  labelOf: (id: string) => string;
}): React.ReactElement {
  const page = data.viewer.pages.find((p) => p.id === pageId);
  const [tab, setTab] = useState(0);

  // 선택된 항목이 다른 탭에 있으면 그 탭으로 옮겨 준다 — 링크로 들어왔을 때 빈 화면이 되지 않게
  useEffect(() => {
    if (!page || page.layout !== 'tabs' || selectedId === null) return;
    const at = page.blocks.findIndex((b) => blockHasId(b, selectedId));
    if (at >= 0) setTab(at);
  }, [page, selectedId]);

  if (!page) return <div className="empty">그런 페이지가 없다.</div>;

  const blocks = page.layout === 'tabs' ? page.blocks.slice(tab, tab + 1) : page.blocks;

  return (
    <div className="page">
      <header className="page__head">
        <h2>{page.title}</h2>
      </header>

      {page.layout === 'tabs' ? (
        <div className="tabs" role="tablist">
          {page.blocks.map((block, i) => (
            <button
              type="button"
              role="tab"
              className="tabs__btn"
              key={block.id ?? i}
              aria-selected={tab === i}
              onClick={() => setTab(i)}
            >
              {block.title ?? `${i + 1}번 블록`}
            </button>
          ))}
        </div>
      ) : null}

      {blocks.map((block, i) => (
        <BlockView
          key={block.id ?? `${page.id}-${i}`}
          bundle={data}
          block={block}
          selectedId={selectedId}
          onSelect={onSelect}
          labelOf={labelOf}
        />
      ))}
    </div>
  );
}

export function App(): React.ReactElement {
  const { route, go } = useRoute();
  const { theme, cycle } = useTheme();

  const entities = useMemo(() => buildEntityIndex(bundle), []);
  const searchIndex = useMemo(() => buildSearchIndex(bundle), []);
  const strip = useMemo(() => findStageStrip(bundle), []);
  // 해설 글 안의 참조 토큰(`D56`·`§ 7.9.2`)을 링크로 푸는 해석기 — 항목 색인과 같이 한 번만 만든다.
  const refResolver = useMemo(() => buildRefResolver(bundle, entities), [entities]);

  const firstPageId = bundle.viewer.pages[0]?.id;
  const pageId = route.kind === 'page' ? route.pageId : route.kind === 'home' ? firstPageId : undefined;
  const selectedId =
    route.kind === 'page' ? route.itemId ?? null : route.kind === 'glossary' ? route.termId ?? null : null;
  const selected = selectedId === null ? undefined : entities.get(selectedId);

  useEffect(() => {
    document.title = bundle.viewer.meta.title;
  }, []);

  // 절·항목 이동은 네이티브 앵커에 기대지 않는다(샌드박스 iframe 대응).
  useEffect(() => {
    if (selectedId === null) return;
    const id = selectedId;
    const timer = window.setTimeout(() => scrollToId(id), 60);
    return () => window.clearTimeout(timer);
  }, [selectedId, pageId]);

  const labelOf = useCallback((id: string) => entities.get(id)?.title ?? id, [entities]);

  const onSelect = useCallback(
    (id: string) => {
      const entity = entities.get(id);
      if (!entity) return;
      if (entity.kind === 'glossary') {
        go({ kind: 'glossary', termId: id });
        return;
      }
      const target = entity.pageId ?? pageId ?? firstPageId;
      if (target === undefined) return;
      // 같은 항목을 다시 누르면 패널을 닫는다
      if (selectedId === id && route.kind === 'page') go({ kind: 'page', pageId: target });
      else go({ kind: 'page', pageId: target, itemId: id });
    },
    [entities, go, pageId, firstPageId, selectedId, route.kind],
  );

  const closePanel = useCallback(() => {
    if (route.kind === 'glossary') go({ kind: 'glossary' });
    else if (route.kind === 'page') go({ kind: 'page', pageId: route.pageId });
  }, [go, route]);

  // Esc로 패널을 닫는다
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, closePanel]);

  let body: React.ReactElement;
  if (route.kind === 'search') {
    body = <SearchPage index={searchIndex} q={route.q} />;
  } else if (route.kind === 'glossary') {
    body = <GlossaryPage bundle={bundle} selectedId={selectedId} onSelect={onSelect} />;
  } else if (route.kind === 'docs') {
    body = (
      <DocsPage
        {...(route.sourceId === undefined ? {} : { sourceId: route.sourceId })}
        {...(route.slug === undefined ? {} : { slug: route.slug })}
      />
    );
  } else if (pageId !== undefined) {
    body = (
      <PageView bundle={bundle} pageId={pageId} selectedId={selectedId} onSelect={onSelect} labelOf={labelOf} />
    );
  } else {
    body = <div className="empty">보여 줄 페이지가 없다.</div>;
  }

  const summary = bundle.viewer.meta.summary;

  return (
    <RefResolverContext.Provider value={refResolver}>
    <div className={`app${selected ? ' app--panel-open' : ''}`}>
      <div className="appbar">
        <TopBar bundle={bundle} route={route} go={go} theme={theme} onToggleTheme={cycle} />
        {strip ? <StageStrip bundle={bundle} strip={strip} currentId={selectedId} /> : null}
      </div>

      <main className={`main${selected ? '' : ' main--single'}`}>
        <div className="page">
          {route.kind === 'home' && summary ? (
            <InlineParagraphs text={summary} className="page__intro" />
          ) : null}
          {body}
        </div>
        {selected ? (
          <EvidencePanel
            bundle={bundle}
            entity={selected}
            status={bundle.status[selected.id]}
            onClose={closePanel}
          />
        ) : null}
      </main>

      <StampBar bundle={bundle} />
    </div>
    </RefResolverContext.Provider>
  );
}
