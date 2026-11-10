// archify 그림 배율 설정: 확장 화면 iframe 에 든 archify 그림(글자·상자)을 통째로 키우는 단계(%).
import { DEFAULT_ARCHIFY_ZOOM, isArchifyZoom, type ArchifyZoom } from '../../../shared/archify-fit.ts';
import { readKey, writeKey } from './storage.ts';

const ARCHIFY_ZOOM_KEY = 'knowledge-viewer.archify-zoom';

/** 저장된 배율. 없거나 단계 밖 값이면 기본(100). */
export function readArchifyZoom(): ArchifyZoom {
  const n = Number(readKey(ARCHIFY_ZOOM_KEY));
  return isArchifyZoom(n) ? n : DEFAULT_ARCHIFY_ZOOM;
}

/** 배율을 적는다. 단계 밖 값은 기본으로 적는다. */
export function writeArchifyZoom(zoom: number): void {
  writeKey(ARCHIFY_ZOOM_KEY, String(isArchifyZoom(zoom) ? zoom : DEFAULT_ARCHIFY_ZOOM));
}
