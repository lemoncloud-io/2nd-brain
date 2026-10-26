// 화면 배치 설정: 왼쪽·오른쪽 열 펴기, 왼쪽·오른쪽 열 폭.
import { readKey, writeKey } from './storage.ts';

const RIGHT_KEY = 'knowledge-viewer.right-open';
const LEFT_OPEN_KEY = 'knowledge-viewer.left-open';
const LEFT_KEY = 'knowledge-viewer.left-width';
const RIGHT_W_KEY = 'knowledge-viewer.right-width';

export function readRightOpen(): boolean {
  return readKey(RIGHT_KEY) !== '0';
}

export function writeRightOpen(open: boolean): void {
  writeKey(RIGHT_KEY, open ? '1' : '0');
}

/** 왼쪽 열(트리)을 펴 두는가. 기본은 편 상태다. */
export function readLeftOpen(): boolean {
  return readKey(LEFT_OPEN_KEY) !== '0';
}

export function writeLeftOpen(open: boolean): void {
  writeKey(LEFT_OPEN_KEY, open ? '1' : '0');
}

export const LEFT_MIN = 180;
export const LEFT_MAX = 640;
export const LEFT_DEFAULT = 280;

/** 왼쪽 열 폭을 허용 범위로 자른다. 숫자가 아니면 기본값. 순수 함수. */
export function clampLeftWidth(n: unknown): number {
  if (n === null || n === undefined || (typeof n === 'string' && n.trim() === '')) return LEFT_DEFAULT;
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return LEFT_DEFAULT;
  return Math.min(LEFT_MAX, Math.max(LEFT_MIN, Math.round(v)));
}

export function readLeftWidth(): number {
  const raw = readKey(LEFT_KEY);
  return raw === null ? LEFT_DEFAULT : clampLeftWidth(raw);
}

export function writeLeftWidth(w: number): void {
  writeKey(LEFT_KEY, String(clampLeftWidth(w)));
}

export const RIGHT_MIN = 240;
export const RIGHT_MAX = 720;
export const RIGHT_DEFAULT = 320;

/** 오른쪽 열 폭을 허용 범위로 자른다. 숫자가 아니면 기본값. 순수 함수. */
export function clampRightWidth(n: unknown): number {
  if (n === null || n === undefined || (typeof n === 'string' && n.trim() === '')) return RIGHT_DEFAULT;
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return RIGHT_DEFAULT;
  return Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, Math.round(v)));
}

export function readRightWidth(): number {
  const raw = readKey(RIGHT_W_KEY);
  return raw === null ? RIGHT_DEFAULT : clampRightWidth(raw);
}

export function writeRightWidth(w: number): void {
  writeKey(RIGHT_W_KEY, String(clampRightWidth(w)));
}

const BOOKMARKS_OPEN_KEY = 'knowledge-viewer.bookmarks-open';

/** 트리 위 ★ 북마크 섹션을 펴 두는가. 기본은 편 상태다. */
export function readBookmarksOpen(): boolean {
  return readKey(BOOKMARKS_OPEN_KEY) !== '0';
}

export function writeBookmarksOpen(open: boolean): void {
  writeKey(BOOKMARKS_OPEN_KEY, open ? '1' : '0');
}
