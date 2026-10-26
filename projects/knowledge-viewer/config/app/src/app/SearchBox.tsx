import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { search } from './api.ts';
import { Highlight } from './Highlight.tsx';
import { isPlainClick } from './links.ts';
import { hrefFor } from './route.ts';
import { setSearchFilter } from './search-filter.ts';
import { rankPrepared, type TitleHit } from './title-match.ts';
import { useTitles } from './titles.ts';
import type { Source } from '../../shared/source.ts';
import type { SearchHit, SearchScope } from './types.ts';

const DEBOUNCE_MS = 300;
/** 제목 절 최대 건수. 목록 전체를 훑고 위만 보인다. */
const TITLE_LIMIT = 20;

type Props = {
  agent: boolean;
  src: Source;
  current: string;
  onNavigate: (path: string) => void;
  /** raw·archive 까지 본다(⚙ 설정). */ scopeAll?: boolean;
};

/**
 * 검색은 두 절이다. 제목 절은 브라우저가 가진 제목 목록(/api/titles)을 입력마다 바로 맞춘다(초성 포함, 디바운스 없음).
 * 본문 절은 300 ms 뒤 /api/search 로, 제목 절에 이미 있는 경로는 뺀다. 질의는 트리 필터(search-filter)에도 건넨다.
 * 결과 링크는 지금 소스를 싣고, 그 소스에 없으면 App 이 폴더 목록으로 떨어뜨린다.
 */
export function SearchBox({ agent, src, current, onNavigate, scopeAll = false }: Props) {
  const [query, setQuery] = useState('');
  const outside = scopeAll;
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // 상단바는 overflow: hidden 이라(#940, 좁은 폭에서 겹침 방지) 목록을 body 에 포털로 띄우고 입력 상자 아래에 고정한다.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const trimmed = query.trim();
  const hasQuery = trimmed !== '';

  // 제목 절: 목록은 처음 글자를 칠 때 받고, 그 뒤엔 입력마다 메모리에서 맞춘다(2,300 건 1 ms 대).
  const titles = useTitles(hasQuery);
  const titleHits = useMemo<TitleHit[]>(
    () => (hasQuery && titles.items !== null ? rankPrepared(trimmed, titles.items, TITLE_LIMIT) : []),
    [hasQuery, trimmed, titles.items],
  );
  const bodyHits = useMemo(() => {
    const seen = new Set(titleHits.map((h) => h.path));
    return hits.filter((h) => !seen.has(h.path));
  }, [hits, titleHits]);
  const flat = useMemo(() => [...titleHits.map((h) => h.path), ...bodyHits.map((h) => h.path)], [titleHits, bodyHits]);

  // 질의를 트리에 건넨다. 상자가 사라져도(에이전트 모드 전환 등) 필터를 남기지 않는다.
  useEffect(() => {
    setSearchFilter(trimmed);
  }, [trimmed]);
  useEffect(() => () => setSearchFilter(''), []);

  // 입력이 바뀌면 키보드 선택을 처음으로 되돌린다.
  useEffect(() => setActive(-1), [trimmed]);

  // 본문 절: 입력이 300 ms 멈추면 검색한다. 늦게 온 옛 응답은 버린다.
  useEffect(() => {
    if (!hasQuery) {
      setHits([]);
      setState('idle');
      return;
    }
    let live = true;
    setState('loading');
    const scope: SearchScope = outside ? 'all' : 'lint';
    const timer = setTimeout(() => {
      search(query, scope).then(
        (r) => {
          if (!live) return;
          setHits(r.hits);
          setState('idle');
        },
        () => live && setState('error'),
      );
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, hasQuery, outside]);

  // 바깥을 누르면 목록을 닫는다. 목록은 포털이라 DOM 으로는 root 밖이다 — 따로 본다.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (root.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // 주소가 바뀌면(트리·뒤로가기 포함) 목록을 닫는다.
  useEffect(() => setOpen(false), [current]);
  useEffect(() => {
    const onPop = () => setOpen(false);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // 키보드로 고른 항목이 보이게 한다.
  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (path: string) => {
    onNavigate(path);
    setOpen(false);
  };

  const showList = open && hasQuery;

  // 목록 자리: 입력 상자의 아래·오른쪽 끝. 열릴 때와 창 크기가 바뀔 때 다시 잰다.
  useLayoutEffect(() => {
    if (!showList) return;
    const place = () => {
      const r = root.current?.getBoundingClientRect();
      if (r)
        setAnchor({
          top: r.bottom,
          right: Math.max(0, window.innerWidth - r.right),
        });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [showList]);
  const bodyNote = state === 'error' ? '본문을 검색하지 못했다.' : state === 'loading' ? '본문 검색 중…' : bodyHits.length === 0 ? '본문 일치가 없다.' : null;
  const titleNote =
    titles.items === null
      ? titles.state === 'error'
        ? '제목 목록을 받지 못했다.'
        : '제목 목록 불러오는 중…'
      : titleHits.length === 0
        ? '제목 일치가 없다.'
        : null;

  const row = (idx: number, path: string, body: ReactNode) => (
    <li key={path}>
      <a
        className={idx === active ? 'search-hit search-active' : 'search-hit'}
        data-idx={idx}
        href={hrefFor(path, undefined, agent, src)}
        onClick={(ev) => {
          if (!isPlainClick(ev)) return;
          ev.preventDefault();
          pick(path);
        }}
      >
        {body}
      </a>
    </li>
  );

  return (
    <div className="searchbox" ref={root}>
      <input
        className="search-input"
        type="search"
        placeholder={outside ? '검색 (raw·archive 포함)' : '검색'}
        aria-label="볼트 검색"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setQuery('');
            setOpen(false);
            return;
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (flat.length === 0) return;
            e.preventDefault();
            setOpen(true);
            const d = e.key === 'ArrowDown' ? 1 : -1;
            setActive((a) => (a + d + flat.length + (a < 0 && d < 0 ? 1 : 0)) % flat.length);
            return;
          }
          if (e.key === 'Enter') {
            const path = flat[active >= 0 ? active : 0];
            if (path === undefined) return;
            e.preventDefault();
            pick(path);
          }
        }}
      />
      {showList && anchor !== null
        ? createPortal(
            <div className="search-results" role="listbox" aria-label="검색 결과" ref={listRef} style={{ top: anchor.top, right: anchor.right }}>
              <p className="search-section">제목</p>
              {titleNote !== null ? (
                <p className="search-note">{titleNote}</p>
              ) : (
                <ul className="search-list">
                  {titleHits.map((h, i) =>
                    row(
                      i,
                      h.path,
                      <>
                        <span className="search-title">
                          <Highlight text={h.title} ranges={h.titleRanges} />
                        </span>
                        <span className="search-path">
                          <Highlight text={h.path} ranges={h.pathRanges} />
                        </span>
                      </>,
                    ),
                  )}
                </ul>
              )}
              <p className="search-section">본문</p>
              {bodyNote !== null ? (
                <p className="search-note">{bodyNote}</p>
              ) : (
                <ul className="search-list">
                  {bodyHits.map((h, i) =>
                    row(
                      titleHits.length + i,
                      h.path,
                      <>
                        <span className="search-title">{h.title}</span>
                        <span className="search-path">{h.path}</span>
                        <span className="search-snippet">{h.snippet}</span>
                      </>,
                    ),
                  )}
                </ul>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
