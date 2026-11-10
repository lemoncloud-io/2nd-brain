// 화면 확장 등록부. 가상 모듈(확장 ui.ts 또는 빈 모듈)을 읽어 검사한 뒤 코어가 쓰는 목록으로 낸다.
// 확장이 없으면 앱 0·보기 0·허용 호스트 빈 목록이다. 모양이 틀리면 모듈을 읽을 때 던진다(코드 실수다).
import ext from 'virtual:knowledge-viewer-ext/ui';

import { SHORTCUTS, type Shortcut } from '../app/shortcuts.ts';
import type { CenterViewExtension, ViewerAppUi, ViewerUiExtension } from './define.ts';

/** 확장 보기가 쓸 수 없는 id(코어 보기). */
export const RESERVED_VIEW_IDS: readonly string[] = ['doc', 'graph'];

/** 검사를 마친 화면 확장. */
export type UiRegistry = { apps: ViewerAppUi[]; views: CenterViewExtension[]; remoteImageHosts: string[]; archifyZoomRow: boolean };

/** 코어 단축키가 쓰는 모든 조합(맥 전용 포함). */
function coreCombos(core: readonly Shortcut[]): Set<string> {
  return new Set(core.flatMap((s) => [...s.keys, ...(s.macKeys ?? [])]));
}

/** 모양 검사: 앱 id·보기 id·단축키·호스트. 틀리면 그 까닭으로 던지고, 맞으면 빈 값을 채워 돌려준다. */
export function checkUiExtension(raw: ViewerUiExtension, core: readonly Shortcut[] = SHORTCUTS): UiRegistry {
  const apps = [...(raw.apps ?? [])];
  const views = [...(raw.views ?? [])];
  const remoteImageHosts = [...(raw.remoteImageHosts ?? [])];
  // 앱: id 문법(서버 등록부와 같다)·중복.
  const appIds = new Set<string>();
  for (const a of apps) {
    if (!/^[a-z0-9-]+$/.test(a.id)) throw new Error(`확장 ui.ts: 앱 id 가 올바르지 않다([a-z0-9-]+): ${a.id}`);
    if (appIds.has(a.id)) throw new Error(`확장 ui.ts: 앱 id 가 겹친다: ${a.id}`);
    appIds.add(a.id);
  }
  // 보기: id 문법·예약어·중복, 단축키는 수식어 없는 한 글자이고 코어·다른 보기와 겹치지 않는다.
  const viewIds = new Set<string>();
  const taken = coreCombos(core);
  for (const v of views) {
    if (!/^[a-z][a-z0-9-]*$/.test(v.id)) throw new Error(`확장 ui.ts: 보기 id 가 올바르지 않다: ${v.id}`);
    if (RESERVED_VIEW_IDS.includes(v.id)) throw new Error(`확장 ui.ts: 보기 id 가 코어 예약어다: ${v.id}`);
    if (viewIds.has(v.id)) throw new Error(`확장 ui.ts: 보기 id 가 겹친다: ${v.id}`);
    viewIds.add(v.id);
    if (typeof v.home?.path !== 'string' || v.home.path === '') throw new Error(`확장 ui.ts: 보기 ${v.id} 에 home.path 가 없다`);
    if (v.shortcut !== undefined) {
      const key = v.shortcut.key;
      if (!/^[a-z0-9]$/.test(key)) throw new Error(`확장 ui.ts: 보기 ${v.id} 의 단축키는 수식어 없는 소문자·숫자 한 글자다: ${key}`);
      if (taken.has(key)) throw new Error(`확장 ui.ts: 보기 ${v.id} 의 단축키 ${key} 가 이미 쓰인다`);
      taken.add(key);
    }
  }
  // 허용 호스트: 빈 문자열이 아닌 문자열만.
  for (const h of remoteImageHosts) {
    if (typeof h !== 'string' || h.trim() === '') throw new Error(`확장 ui.ts: 원격 이미지 호스트가 올바르지 않다: ${String(h)}`);
  }
  return { apps, views, remoteImageHosts, archifyZoomRow: views.some((v) => v.archifyZoom === true) };
}

const REGISTRY = checkUiExtension(ext);

/** 앱 화면 목록(확장 순서). */
export const APP_UIS: ViewerAppUi[] = REGISTRY.apps;
/** 가운데 열 확장 화면 목록. */
export const EXT_VIEWS: CenterViewExtension[] = REGISTRY.views;
/** ⚙ 원격 이미지 허용 호스트 기본값. */
export const DEFAULT_REMOTE_IMAGE_HOSTS: readonly string[] = REGISTRY.remoteImageHosts;
/** ⚙ "그림 글자" 줄을 보이는가(등록된 보기 중 하나가 archifyZoom). */
export const ARCHIFY_ZOOM_ROW: boolean = REGISTRY.archifyZoomRow;
