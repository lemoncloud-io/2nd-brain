import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getTree } from './api.ts';
import { Highlight } from './Highlight.tsx';
import { isPlainClick } from './links.ts';
import { matchTitle } from './title-match.ts';
import { useTitles } from './titles.ts';
import { filterTree, type FilteredDir } from './tree-filter.ts';
import { BookmarkSection } from './BookmarkSection.tsx';
import { TreeStar } from './TreeStar.tsx';
import { useBookmarks } from './useBookmarks.ts';
import { hrefFor } from './route.ts';
import { isTextPath } from '../../shared/text-ext.ts';
import { changedUnder, deltaOf, type ChangedMap } from './changed.ts';
import type { RevealRequest, Source, TreeEntry } from './types.ts';

/** 앱 안에서 여는 파일: md(리더)·html(iframe)·텍스트(파일 보기). */
const isLinkable = (e: TreeEntry): boolean => e.kind === 'md' || e.kind === 'html' || (e.kind === 'file' && isTextPath(e.path));

type Props = {
  current: string;
  agent: boolean;
  /** 지금 소스. 바뀌면 App 이 key 로 트리를 새로 만든다. */
  src: Source;
  reveal: RevealRequest;
  onOpen: (path: string) => void;
  /** PR 소스일 때 그 PR 이 바꾼 파일(볼트 경로 → A·M·D·R). */
  changed?: ChangedMap;
  /** 검색 상자의 질의. 비어 있지 않으면 맞는 문서와 그 상위 폴더만 보인다(제목 목록 기준, 초성 포함). */
  filter?: string;
};

/** 필터가 보이는 최대 문서 수. 넘으면 점수 순으로 자르고 수를 알린다. */
const FILTER_LIMIT = 300;

type Slot = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; entries: TreeEntry[] };

export function Tree({ current, agent, src, reveal, onOpen, changed, filter = '' }: Props) {
  const { items: bookmarks } = useBookmarks();
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [open, setOpen] = useState<Set<string>>(() => new Set(['']));
  const requested = useRef<Set<string>>(new Set());

  const load = useCallback(
    (dir: string) => {
      if (requested.current.has(dir)) return;
      requested.current.add(dir);
      setSlots((s) => ({ ...s, [dir]: { state: 'loading' } }));
      getTree(dir, src).then(
        (r) => setSlots((s) => ({ ...s, [dir]: { state: 'ready', entries: r.entries } })),
        (e: unknown) => {
          requested.current.delete(dir);
          setSlots((s) => ({ ...s, [dir]: { state: 'error', message: e instanceof Error ? e.message : String(e) } }));
        },
      );
    },
    [src],
  );

  useEffect(() => load(''), [load]);

  // 경로 표시줄 조각 클릭·첫 진입: 그 폴더와 윗 폴더를 모두 펼친다.
  useEffect(() => {
    const segs = reveal.dir.split('/').filter((s) => s !== '');
    const dirs = ['', ...segs.map((_, i) => segs.slice(0, i + 1).join('/'))];
    setOpen((o) => new Set([...o, ...dirs]));
    dirs.forEach(load);
  }, [reveal, load]);

  const toggle = (dir: string) => {
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(dir)) n.delete(dir);
      else n.add(dir);
      return n;
    });
    load(dir);
  };

  const renderDir = (dir: string, depth: number) => {
    const slot = slots[dir];
    if (slot === undefined || slot.state === 'loading')
      return (
        <div className="tree-note" style={{ paddingLeft: pad(depth) }}>
          …
        </div>
      );
    if (slot.state === 'error')
      return (
        <div className="tree-note tree-error" style={{ paddingLeft: pad(depth) }}>
          {slot.message}
        </div>
      );
    return (
      <ul className="tree-list" role={depth === 0 ? 'tree' : 'group'}>
        {slot.entries.map((e) => (
          <li
            key={e.path}
            role="treeitem"
            aria-expanded={e.kind === 'dir' ? open.has(e.path) : undefined}
            className={isLinkable(e) ? 'tree-item-file' : undefined}
          >
            {e.kind === 'dir' ? (
              <>
                <button type="button" className="tree-row tree-dir" style={{ paddingLeft: pad(depth) }} onClick={() => toggle(e.path)}>
                  <span className="tree-caret">{open.has(e.path) ? '▾' : '▸'}</span>
                  <span className="tree-name">{e.name}</span>
                  {changedUnder(changed, e.path) ? <span className="tree-dot" title="이 PR 이 바꾼 문서가 있다" /> : null}
                  {e.ignored ? <span className="badge badge-local">local</span> : null}
                </button>
                {open.has(e.path) ? renderDir(e.path, depth + 1) : null}
              </>
            ) : isLinkable(e) ? (
              <a
                href={hrefFor(e.path, undefined, agent, src)}
                className={e.path === current ? 'tree-row tree-file tree-current' : 'tree-row tree-file'}
                style={{ paddingLeft: pad(depth) }}
                title={e.path}
                onClick={(ev) => {
                  if (!isPlainClick(ev)) return;
                  ev.preventDefault();
                  onOpen(e.path);
                }}
              >
                <span className="tree-caret" />
                <span className={changed?.get(e.path) === 'D' ? 'tree-name tree-deleted' : 'tree-name'}>{e.kind === 'md' ? (e.title ?? e.name) : e.name}</span>
                <Delta status={changed?.get(e.path)} />
                {e.kind === 'html' ? <span className="badge badge-html">html</span> : null}
                {e.ignored ? <span className="badge badge-local">local</span> : null}
              </a>
            ) : (
              <span className="tree-row tree-other" style={{ paddingLeft: pad(depth) }} title={e.path}>
                <span className="tree-caret" />
                <span className={changed?.get(e.path) === 'D' ? 'tree-name tree-deleted' : 'tree-name'}>{e.name}</span>
                <Delta status={changed?.get(e.path)} />
              </span>
            )}
            {e.kind === 'md' || e.kind === 'html' ? <TreeStar path={e.path} title={e.kind === 'md' ? (e.title ?? e.name) : e.name} /> : null}
          </li>
        ))}
      </ul>
    );
  };

  // 필터: 제목 목록으로 짠 가상 트리다. 폴더는 다 펼쳐 보이고, 접은 폴더는 필터가 바뀌면 다시 펼쳐진다.
  const filterQ = filter.trim();
  const titles = useTitles(filterQ !== '');
  const filtered = useMemo(
    () =>
      filterQ === '' || titles.items === null
        ? null
        : filterTree(
            filterQ,
            titles.items.map((p) => p.item),
            FILTER_LIMIT,
          ),
    [filterQ, titles.items],
  );
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  useEffect(() => setClosed(new Set()), [filterQ]);

  const renderFiltered = (dir: FilteredDir, depth: number) => (
    <ul className="tree-list" role={depth === 0 ? 'tree' : 'group'}>
      {dir.dirs.map((d) => (
        <li key={d.path} role="treeitem" aria-expanded={!closed.has(d.path)}>
          <button
            type="button"
            className="tree-row tree-dir"
            style={{ paddingLeft: pad(depth) }}
            onClick={() =>
              setClosed((c) => {
                const n = new Set(c);
                if (n.has(d.path)) n.delete(d.path);
                else n.add(d.path);
                return n;
              })
            }
          >
            <span className="tree-caret">{closed.has(d.path) ? '▸' : '▾'}</span>
            <span className="tree-name">{d.name}</span>
            {changedUnder(changed, d.path) ? <span className="tree-dot" title="이 PR 이 바꾼 문서가 있다" /> : null}
          </button>
          {closed.has(d.path) ? null : renderFiltered(d, depth + 1)}
        </li>
      ))}
      {dir.files.map((f) => (
        <li key={f.path} role="treeitem" className="tree-item-file">
          <a
            href={hrefFor(f.path, undefined, agent, src)}
            className={f.path === current ? 'tree-row tree-file tree-current' : 'tree-row tree-file'}
            style={{ paddingLeft: pad(depth) }}
            title={f.path}
            onClick={(ev) => {
              if (!isPlainClick(ev)) return;
              ev.preventDefault();
              onOpen(f.path);
            }}
          >
            <span className="tree-caret" />
            <span className={changed?.get(f.path) === 'D' ? 'tree-name tree-deleted' : 'tree-name'}>
              <Highlight text={f.title} ranges={f.ranges} />
            </span>
            <Delta status={changed?.get(f.path)} />
          </a>
          <TreeStar path={f.path} title={f.title} />
        </li>
      ))}
    </ul>
  );

  // 북마크 섹션도 같은 질의로 걸러진다(제목 또는 경로). 질의가 없으면 전부다.
  const bookmarksShown = useMemo(
    () => (filterQ === '' ? bookmarks : bookmarks.filter((b) => matchTitle(filterQ, b.title) !== null || matchTitle(filterQ, b.path) !== null)),
    [filterQ, bookmarks],
  );

  if (filterQ !== '') {
    return (
      <div className="tree tree-filtered" data-filter={filterQ}>
        <BookmarkSection items={bookmarksShown} current={current} agent={agent} src={src} onOpen={onOpen} />
        {filtered === null ? (
          <div className="tree-note">{titles.state === 'error' ? '제목 목록을 받지 못했다.' : '제목 목록 불러오는 중…'}</div>
        ) : filtered.total === 0 ? (
          <div className="tree-note">맞는 문서가 없다.</div>
        ) : (
          <>
            <div className="tree-note tree-filter-note">
              {filtered.shown < filtered.total ? `${filtered.total.toLocaleString()} 건 중 ${filtered.shown} 건 — 더 좁혀 달라` : `${filtered.total} 건`}
            </div>
            {renderFiltered(filtered.root, 0)}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="tree">
      <BookmarkSection items={bookmarks} current={current} agent={agent} src={src} onOpen={onOpen} />
      {renderDir('', 0)}
    </div>
  );
}

const pad = (depth: number): number => 8 + depth * 14;

const DELTA_TITLE = { A: '이 PR 이 더함', M: '이 PR 이 고침', R: '이 PR 이 이름을 바꿈', D: '이 PR 이 지움' } as const;

/** PR 변경 배지. 상태가 없으면 아무것도 그리지 않는다. */
export function Delta({ status }: { status: 'A' | 'M' | 'D' | 'R' | undefined }) {
  if (status === undefined) return null;
  return (
    <span className="tree-delta" title={DELTA_TITLE[status]}>
      {deltaOf(status)}
    </span>
  );
}
