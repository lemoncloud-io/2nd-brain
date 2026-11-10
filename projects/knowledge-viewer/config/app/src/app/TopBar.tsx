import { useCallback, useEffect, useRef, useState } from 'react';

import type { Source } from '../../shared/source.ts';
import { isPlainClick } from './links.ts';
import { crumbTarget, hrefFor, type View, type NavigateFn } from './route.ts';
import { IconMap, IconPanelLeft, IconPanelRight, IconSearch } from './icons.tsx';
import { onShortcutEvent } from './shortcut-events.ts';
import { detectPlatform, formatKeys } from './shortcuts.ts';
import { PrBadge } from './PrBadge.tsx';
import { SearchBox } from './SearchBox.tsx';
import { SettingsMenu } from './SettingsMenu.tsx';
import { VaultBadge } from './VaultBadge.tsx';
import { BookmarkButton } from './BookmarkButton.tsx';
import { isFolderPath } from './route.ts';
import type { PrChanges, VaultInfo } from './types.ts';
import type { PanelPrefs } from '../panels/prefs.ts';
import type { Panel } from '../panels/registry.ts';
import { AppsMenu } from '../apps/AppsMenu.tsx';
import type { ViewerAppUi } from '../apps/registry.ts';
import type { CenterViewExtension } from '../ext/define.ts';

/** 확장 화면이 없을 때(기본값). 그리기마다 새 배열이면 단축키 구독이 다시 걸린다. */
const NO_VIEWS: readonly CenterViewExtension[] = [];

type Props = {
  path: string;
  agent: boolean;
  /** 가운데 열이 리더(doc)인지 지도(graph)인지. */
  view: View;
  rightOpen: boolean;
  leftOpen: boolean;
  /** 현재 문서 제목(북마크에 담을 이름). 없으면 파일 이름. */
  docTitle?: string;
  onExpand: (dir: string) => void;
  onNavigate: NavigateFn;
  /** 검색 상자에서 문서를 골랐다. 지도 보기면 App 이 그 문서를 중심으로 다시 그린다. */
  onSearchPick: (path: string) => void;
  /** 검색 상자의 PR 번호 입력 → 그 PR 로(App 의 enterPr). */
  onEnterPr?: (number: number) => void;
  onToggleRight: () => void;
  onToggleLeft: () => void;
  /** 리더 ↔ 지도. */
  onToggleView: () => void;
  /** 지금 소스. 링크가 모두 싣는다. */
  src: Source;
  /** 선택 상자에 싣는 볼트 레포 PR. */
  prs: { number: number; title: string }[];
  mainAvailable: boolean;
  onSourceChange: (src: Source) => void;
  info: VaultInfo | null;
  /** 배지에 보일 커밋(문서의 head, 없으면 main 머리). */
  head: string | null;
  /** main 을 못 써 local 로 떨어졌으면 그 까닭. */
  fallbackReason: string | null;
  /** pr 소스의 변경 목록(PR 정보). 받기 전·다른 소스면 null. */
  changes: PrChanges | null;
  /** pr 소스의 변경 목록을 못 받은 까닭. 없으면 null. */
  changesError?: string | null;
  /** PR 배지를 눌렀다. */
  onBadgeClick: () => void;
  /** 검색이 raw·archive 까지 보는가(설정 메뉴에서 바꾼다). */
  searchAll: boolean;
  onSearchAll: (on: boolean) => void;
  /** 오른쪽 열 패널 켜기·순서(⚙ 안의 목록). */
  panels?: Panel[];
  panelPrefs?: PanelPrefs;
  onPanelPrefs?: (p: PanelPrefs) => void;
  /** 상단바 "앱" 메뉴에 싣는 앱(화면 등록부). 비면 메뉴가 없다. */
  apps?: ViewerAppUi[];
  /** 가운데 열 확장 화면(단추 하나씩, 앱 메뉴 앞). 없으면 단추가 없다. */
  views?: readonly CenterViewExtension[];
  /** 앱 화면(`/apps/<id>`)이면 그 앱. 경로 표시줄은 "앱 / 제목"이고 양옆 열 토글·지도·북마크는 없다. */
  app?: { id: string; title: string };
};

/**
 * 상단바. 왼쪽부터 `[트리 토글] 경로 … [지도] [북마크] [검색] [배지] [설정] [패널 토글]`.
 * 경로는 늘어나고 나머지는 고정 폭이다. 자주 안 쓰는 조절(소스·검색 범위·패널 켜기)은 ⚙ 안에 있어
 * 좁은 폭에서도 줄이 넘치지 않는다. 배지는 소스를 보여 주는 자리이고, 바꾸는 곳은 ⚙ 이다.
 * 검색은 아이콘·단축키로 열고, 폰 폭(≤ 640px)에서는 상단바 아래 전폭 줄로 편다.
 */
export function TopBar(props: Props) {
  const { path, agent, view, rightOpen, leftOpen, docTitle, onExpand, onNavigate, onSearchPick,
  onEnterPr, onToggleRight, onToggleLeft, onToggleView } = props;
  const { src, prs, mainAvailable, onSourceChange, info, head, fallbackReason, changes, changesError = null, onBadgeClick } = props;
  const { searchAll, onSearchAll, panels, panelPrefs, onPanelPrefs, apps = [], views = NO_VIEWS, app } = props;
  const prBadge = src.kind === 'pr' && changes !== null && changes.number === src.number ? changes : null;
  const segs = path.split('/').filter((s) => s !== '');
  // 모든 폭에서 같은 열림 상태를 쓴다. 검색 단축키도 먼저 펼친 뒤 입력에 포커스한다.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const platform = detectPlatform();
  // 확장 화면 열기: 검색을 접고 그 화면의 첫 주소로 간다. 단축키 알림(view:<id>)도 같은 일을 한다.
  const openView = useCallback((v: CenterViewExtension) => {
    setSearchOpen(false);
    onNavigate(v.home.path, v.home.anchor, undefined, v.id);
  }, [onNavigate]);
  useEffect(() => {
    const offs = views.map((v) => onShortcutEvent(`view:${v.id}`, () => openView(v)));
    return () => offs.forEach((off) => off());
  }, [views, openView]);
  useEffect(() => {
    const open = () => setSearchOpen(true);
    const offSearch = onShortcutEvent('search', open);
    const offPr = onShortcutEvent('pr-search', open);
    return () => { offSearch(); offPr(); };
  }, []);
  useEffect(() => {
    if (searchOpen) slotRef.current?.querySelector('input')?.focus();
  }, [searchOpen]);
  useEffect(() => setSearchOpen(false), [path, src]);
  useEffect(() => {
    if (!searchOpen) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (slotRef.current?.contains(target) || searchButton.current?.contains(target) || target?.closest('.search-results')) return;
      setSearchOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [searchOpen]);
  const crumb = (dir: string, label: string) => {
    const target = crumbTarget(dir);
    return (
      <a
        className="crumb"
        href={hrefFor(target, undefined, agent, src)}
        onClick={(e) => {
          if (!isPlainClick(e)) return;
          e.preventDefault();
          onExpand(dir);
          onNavigate(target);
        }}
      >
        {label}
      </a>
    );
  };
  return (
    <header className="topbar">
      {agent || app !== undefined ? null : (
        <button
          type="button"
          className="icon-btn left-toggle"
          aria-pressed={leftOpen}
          aria-label={leftOpen ? '왼쪽 패널 접기' : '왼쪽 패널 펴기'}
          title={leftOpen ? '왼쪽 패널 접기' : '왼쪽 패널 펴기'}
          onClick={onToggleLeft}
        >
          <IconPanelLeft open={leftOpen} />
        </button>
      )}
      <nav className="crumbs" aria-label="경로">
        <span className="crumb-item crumb-root">{crumb('', '/')}</span>
        {/* 앱 화면: 볼트 경로 대신 "앱 / 제목". */}
        {app !== undefined ? (
          <span className="crumb-item crumb-tail">
            <span className="crumb">앱</span>
            <span className="crumb-sep">/</span>
            <span className="crumb crumb-file" aria-current="page">
              {app.title}
            </span>
          </span>
        ) : null}
        {app !== undefined ? null : segs.map((seg, i) => {
          const last = i === segs.length - 1;
          // 끝 두 조각은 폰 폭에서도 남는다(crumb-tail).
          return (
            <span key={i} className={i >= segs.length - 2 ? 'crumb-item crumb-tail' : 'crumb-item'}>
              {last ? (
                <span className="crumb crumb-file" aria-current="page">
                  {seg}
                </span>
              ) : (
                crumb(segs.slice(0, i + 1).join('/'), seg)
              )}
              {last ? null : <span className="crumb-sep">/</span>}
            </span>
          );
        })}
      </nav>
      {agent ? null : (
        <div className="topbar-actions">
          {views.map((v) => {
            const Icon = v.icon;
            const key = v.shortcut?.key;
            return (
              <a key={v.id} className={`icon-btn ${v.id}-toggle`} aria-label={v.title} title={key === undefined ? v.title : `${v.title} (${formatKeys(key, platform).toUpperCase()})`}
                aria-keyshortcuts={key} aria-current={view === v.id ? 'page' : undefined}
                href={hrefFor(v.home.path, v.home.anchor, agent, src, v.id)}
                onClick={e => { if (!isPlainClick(e)) return; e.preventDefault(); openView(v); }}>
                <Icon />
              </a>
            );
          })}
          <AppsMenu apps={apps} agent={agent} current={app?.id} />
          {/* 지도는 md 문서에서만 그린다. */}
          {app === undefined && path.endsWith('.md') ? (
            <button
              type="button"
              className="icon-btn view-toggle"
              aria-pressed={view === 'graph'}
              aria-label={view === 'graph' ? '문서로 돌아가기' : '연결 지도'}
              title={view === 'graph' ? '문서로 돌아가기' : '이 문서 중심의 링크 지도'}
              onClick={onToggleView}
            >
              <IconMap />
            </button>
          ) : null}
          {app !== undefined || isFolderPath(path) ? null : <BookmarkButton path={path} title={docTitle ?? (segs[segs.length - 1] ?? path)} />}
          <button
            type="button"
            className="icon-btn search-toggle"
            aria-expanded={searchOpen}
            aria-label={searchOpen ? '검색 닫기' : '검색 열기'}
            aria-controls="vault-search"
            aria-keyshortcuts={platform === 'mac' ? '/ Meta+k' : '/ Control+k'}
            title={searchOpen ? '검색 닫기 (Esc)' : `검색 (/ · ${formatKeys('mod+k', platform)})`}
            ref={searchButton}
            onClick={() => setSearchOpen((v) => !v)}
          >
            <IconSearch />
          </button>
          <div
            className={searchOpen ? 'search-slot search-slot-open' : 'search-slot'}
            data-slot="search"
            id="vault-search"
            hidden={!searchOpen}
            ref={slotRef}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setSearchOpen(false);
                searchButton.current?.focus();
              }
            }}
          >
            <SearchBox
              expanded={searchOpen}
              agent={agent}
              src={src}
              current={path}
              scopeAll={searchAll}
              onNavigate={(p) => {
                setSearchOpen(false);
                onSearchPick(p);
              }}
              onEnterPr={
                onEnterPr === undefined
                  ? undefined
                  : (n) => {
                      setSearchOpen(false);
                      onEnterPr(n);
                    }
              }
            />
          </div>
        </div>
      )}
      {/* 오른쪽 귀퉁이: pr 소스면 PR 배지, 아니면 저장소·소스 배지. 바꾸는 곳은 ⚙ 이다. */}
      {prBadge !== null ? (
        <span className="pr-badge-wrap">
          <PrBadge changes={prBadge} onClick={onBadgeClick} agent={agent} />
        </span>
      ) : (
        <VaultBadge info={info} src={src} head={head} fallbackReason={fallbackReason} srcReason={changesError} />
      )}
      {agent ? null : (
        <SettingsMenu
          src={src}
          prs={prs}
          mainAvailable={mainAvailable}
          onSourceChange={onSourceChange}
          onEnterPr={onEnterPr}
          fallbackReason={fallbackReason}
          searchAll={searchAll}
          onSearchAll={onSearchAll}
          leftOpen={leftOpen}
          rightOpen={rightOpen}
          onToggleLeft={onToggleLeft}
          onToggleRight={onToggleRight}
          panels={panels}
          panelPrefs={panelPrefs}
          onPanelPrefs={onPanelPrefs}
        />
      )}
      {agent || app !== undefined ? null : (
        <button
          type="button"
          className="icon-btn right-toggle"
          aria-pressed={rightOpen}
          aria-label={rightOpen ? '오른쪽 패널 접기' : '오른쪽 패널 펴기'}
          title={rightOpen ? '오른쪽 패널 접기' : '오른쪽 패널 펴기'}
          onClick={onToggleRight}
        >
          <IconPanelRight open={rightOpen} />
        </button>
      )}
    </header>
  );
}
