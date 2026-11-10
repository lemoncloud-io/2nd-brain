// 확장 층의 화면 계약. 확장 폴더의 `ui.ts` 가 defineUiExtension(...) 을 기본 내보내기로 낸다.
// 이 파일은 런타임 import 가 없다(타입만) — ui.ts 가 정적으로 불러도 코어 등록부와 순환이 생기지 않는다.
import type { ComponentType } from 'react';

import type { Source } from '../../shared/source.ts';
import type { NavigateFn } from '../app/route.ts';
import type { AppHostProps, ViewerAppUi } from '../apps/registry.ts';

export type { AppHostProps, NavigateFn, Source, ViewerAppUi };

/** /raw 출처를 짓는 데 필요한 /api/info 값. ready 전에는 git 소스·개인 이름 틀을 열지 않는다. */
export type FramePorts = { gitRawPort: number | null; rawPort: number | null; ready: boolean };

/** 가운데 열 확장 화면이 받는 것. */
export type CenterViewProps = { src: Source; agent: boolean; navigate: NavigateFn; frame: FramePorts };

/** 가운데 열 확장 화면 하나(`?view=<id>`). 상단바 단추·단축키·옛 주소를 함께 선언한다. */
export interface CenterViewExtension {
  /** `?view=<id>` 값. /^[a-z][a-z0-9-]*$/, `doc`·`graph` 는 예약어다. */
  id: string;
  /** 단추 aria-label, title "<title> (<KEY>)", 불러오는 중 문구. */
  title: string;
  /** 상단바 단추 아이콘. */
  icon: ComponentType<{ size?: number }>;
  /** 단추·단축키가 여는 곳. 이 보기의 문서 경로는 늘 home.path 다. */
  home: { path: string; anchor?: string };
  /** 이 경로로 들어온 주소는 이 보기로 연다(옛 주소). */
  legacyPaths?: readonly string[];
  /** 수식어 없는 한 글자, 탐색 묶음. 코어 키와 겹치면 시작 때 거부한다. */
  shortcut?: { key: string; desc: string };
  /** 안쪽 HashRouter 를 쓰는가: 앵커 = `#/…` 해시(아니면 home.anchor), 바깥 이동 뒤 popstate, 소스 전환 때 실제 해시 유지. */
  hashRouted?: boolean;
  /** 이 보기에서 그리지 않을 오른쪽 패널 id(예: 'toc'). */
  hidePanels?: readonly string[];
  /** ⚙ "그림 글자" 줄을 보인다. */
  archifyZoom?: boolean;
  /** 화면 컴포넌트(지연 청크). */
  load: () => Promise<{ default: ComponentType<CenterViewProps> }>;
}

/** 확장 ui.ts 가 내는 것. 모두 선택이다. */
export interface ViewerUiExtension {
  /** 앱 화면(/apps/<id>). */
  apps?: readonly ViewerAppUi[];
  /** 가운데 열 화면. */
  views?: readonly CenterViewExtension[];
  /** ⚙ 원격 이미지 허용 호스트 기본값. 없으면 빈 목록. */
  remoteImageHosts?: readonly string[];
}

/** 확장 작성용 항등 함수(타입만 잡는다). */
export function defineUiExtension(ext: ViewerUiExtension): ViewerUiExtension {
  return ext;
}
