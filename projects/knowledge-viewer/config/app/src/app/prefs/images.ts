// 원격 이미지 설정: 보기 토글(기본 끔)과 허용 호스트 목록(기본 조직 CDN).
import { DEFAULT_REMOTE_IMAGE_HOSTS, normalizeHostEntry } from '../../../shared/image-src.ts';
import { readKey, writeKey } from './storage.ts';

const REMOTE_IMAGES_KEY = 'knowledge-viewer.remote-images';
const REMOTE_IMAGE_HOSTS_KEY = 'knowledge-viewer.remote-image-hosts';

/** 원격 이미지를 보는가. 기본은 끔 — 켜기 전엔 바깥으로 요청이 나가지 않는다. */
export function readRemoteImages(): boolean {
  return readKey(REMOTE_IMAGES_KEY) === '1';
}

export function writeRemoteImages(on: boolean): void {
  writeKey(REMOTE_IMAGES_KEY, on ? '1' : '0');
}

/** 허용 호스트 목록(JSON 배열). 없거나 깨졌으면 기본값, 꼴이 아닌 칸은 버린다. 빈 배열은 사용자가 다 지운 것이라 그대로 둔다. */
export function readRemoteImageHosts(): string[] {
  const v = readKey(REMOTE_IMAGE_HOSTS_KEY);
  if (v === null) return [...DEFAULT_REMOTE_IMAGE_HOSTS];
  try {
    const parsed: unknown = JSON.parse(v);
    if (!Array.isArray(parsed)) return [...DEFAULT_REMOTE_IMAGE_HOSTS];
    const out: string[] = [];
    for (const item of parsed) {
      const e = typeof item === 'string' ? normalizeHostEntry(item) : null;
      if (e !== null && !out.includes(e)) out.push(e);
    }
    return out;
  } catch {
    return [...DEFAULT_REMOTE_IMAGE_HOSTS];
  }
}

export function writeRemoteImageHosts(hosts: readonly string[]): void {
  writeKey(REMOTE_IMAGE_HOSTS_KEY, JSON.stringify(hosts));
}
