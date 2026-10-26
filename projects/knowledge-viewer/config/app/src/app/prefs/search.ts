// 검색 설정: raw·archive 까지 보는가.
import { readKey, writeKey } from './storage.ts';

const SEARCH_ALL_KEY = 'knowledge-viewer.search-all';

/** 검색이 raw·archive 까지 보는가. 기본은 lint 범위만. */
export function readSearchAll(): boolean {
  return readKey(SEARCH_ALL_KEY) === '1';
}

export function writeSearchAll(on: boolean): void {
  writeKey(SEARCH_ALL_KEY, on ? '1' : '0');
}
