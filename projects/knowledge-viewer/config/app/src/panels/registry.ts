// 오른쪽 열 패널 등록부. 패널을 더하려면 파일 하나와 PANELS 의 한 줄이다.
// 등록은 빌드 시(이 배열)이고, 켜기·순서는 prefs.ts(localStorage)가 맡는다.
import { createElement, type ComponentType, type ReactNode } from 'react';

import { IconBacklink, IconDiff, IconGrid, IconInfo, IconMap, IconPr, IconStar, IconToc } from '../app/icons.tsx';
import type { NavigateFn } from '../app/route.ts';
import type { DocChange, DocResponse, PrChanges, Source } from '../app/types.ts';
import { Backlinks } from '../reader/Backlinks.tsx';
import { MetaPanel } from '../reader/MetaPanel.tsx';
import { Toc } from '../reader/Toc.tsx';
import { docEndLine } from '../reader/toc-changed.ts';
import { BookmarksPanel } from './BookmarksPanel.tsx';
import { GraphPanel } from './GraphPanel.tsx';
import { PrDetailPanel } from './PrDetailPanel.tsx';
import { PrPanel } from './PrPanel.tsx';
import { ViewersPanel } from './ViewersPanel.tsx';

export type PanelContext = {
  /** md 문서가 아니거나 아직 못 읽었으면 null 이다. */
  doc: DocResponse | null;
  /** 현재 경로. */
  path: string;
  agent: boolean;
  /** 지금 소스. 링크가 싣는다. */
  src: Source;
  /** src 를 빼면 지금 소스를 유지한다. 넷째 인자로 지도 보기(`'graph'`·GraphTarget)를 줄 수 있다. */
  navigate: NavigateFn;
  /** 같은 경로를 다른 소스로 연다. */
  setSource: (src: Source) => void;
  /** pr 소스의 변경 목록. 다른 소스거나 아직 못 받았으면 null. */
  changes: PrChanges | null;
  /** 지금 문서의 변경(`doc.change`). 없으면 null. */
  change: DocChange | null;
  /** 변경 목록을 받다 실패한 까닭(화면 쪽 요청). 없으면 null. */
  changesError: string | null;
};

export type Panel = {
  /** 설정 키. 바꾸지 않는다. */
  id: string;
  title: string;
  /** 제목 앞 아이콘(currentColor, 크기는 PanelHeading 이 준다). 패널마다 다른 모양이다. */
  icon: ComponentType<{ size?: number }>;
  render: (ctx: PanelContext) => ReactNode;
  /** 기본 true. true 면 doc 이 null 일 때 그리지 않는다. */
  needsDoc?: boolean;
  /** 기본 true. false 면 처음엔 꺼져 있다. */
  defaultOn?: boolean;
  /** 기본 false. true 면 처음엔 본문이 접혀 제목만 보인다. 펴고 접은 것은 브라우저에 남는다. */
  defaultCollapsed?: boolean;
};

/** 북마크 패널 아이콘: 빈 별(상단바의 북마크 단추와 같은 모양). */
function BookmarkIcon({ size }: { size?: number }) {
  return createElement(IconStar, { on: false, size });
}

export const PANELS: Panel[] = [
  // 기본 순서(2026-10-24): PR 상세(pr 소스에서만) → 연결 지도 → 목차 → 역링크 → 문서 정보 → 진행 중 PR → 뷰어 모음 → 북마크(기본 끔).
  // 순서를 바꾸면 prefs.ts 의 PREFS_VERSION 을 올린다.
  // PR 상세. pr 소스일 때만 그린다. 문서가 없어도(폴더 목록) 뜬다.
  {
    id: 'prdetail',
    title: 'PR 상세',
    icon: IconDiff,
    needsDoc: false,
    defaultOn: true,
    render: (ctx) =>
      ctx.src.kind !== 'pr'
        ? null
        : createElement(PrDetailPanel, {
            changes: ctx.changes,
            change: ctx.change,
            changesError: ctx.changesError,
            changeError: ctx.doc?.changeError ?? null,
            path: ctx.path,
            agent: ctx.agent,
            src: ctx.src,
            navigate: ctx.navigate,
          }),
  },
  // 연결 지도. 중심 문서의 1홉 이웃을 작은 2D 캔버스로 그린다. 그래프 라이브러리는 패널 안에서 lazy 로 불러온다.
  {
    id: 'graph',
    title: '연결 지도',
    icon: IconMap,
    render: (ctx) => createElement(GraphPanel, { path: ctx.path, agent: ctx.agent, navigate: ctx.navigate }),
  },
  {
    id: 'toc',
    title: '목차',
    icon: IconToc,
    render: (ctx) =>
      ctx.doc === null
        ? null
        : createElement(Toc, {
            headings: ctx.doc.headings,
            change: ctx.doc.change ?? undefined,
            endLine: docEndLine(ctx.doc.body, ctx.doc.bodyStartLine),
          }),
  },
  {
    id: 'backlinks',
    title: '역링크',
    icon: IconBacklink,
    render: (ctx) =>
      ctx.doc === null ? null : createElement(Backlinks, { items: ctx.doc.backlinks, agent: ctx.agent, src: ctx.src, onNavigate: ctx.navigate }),
  },
  { id: 'meta', title: '문서 정보', icon: IconInfo, render: (ctx) => (ctx.doc === null ? null : createElement(MetaPanel, { doc: ctx.doc })) },
  // 첫 외부 패널. 문서가 없어도 뜬다(needsDoc false). 데이터는 /api/panels/prs*.
  {
    id: 'prs',
    title: '진행 중 PR',
    icon: IconPr,
    needsDoc: false,
    defaultCollapsed: true,
    render: (ctx) =>
      createElement(PrPanel, { agent: ctx.agent, path: ctx.path, src: ctx.src, onSource: ctx.setSource, onNavigate: ctx.navigate }),
  },
  // 뷰어 모음. 볼트의 뷰어 스킬을 버튼으로 모아 새 탭에서 연다. 데이터는 /api/panels/viewers(등록부 viewers.yml).
  {
    id: 'viewers',
    title: '뷰어 모음',
    icon: IconGrid,
    needsDoc: false,
    defaultOn: true,
    defaultCollapsed: true,
    render: (ctx) => createElement(ViewersPanel, { agent: ctx.agent, navigate: ctx.navigate }),
  },
  // 북마크. 문서가 없어도 뜬다. 저장은 브라우저뿐.
  {
    id: 'bookmarks',
    title: '북마크',
    icon: BookmarkIcon,
    needsDoc: false,
    // 트리 위 ★ 섹션과 겹쳐 기본은 끈다(2026-10-24).
    defaultOn: false,
    render: (ctx) => createElement(BookmarksPanel, { current: ctx.path, agent: ctx.agent, src: ctx.src, onNavigate: ctx.navigate }),
  },
];
