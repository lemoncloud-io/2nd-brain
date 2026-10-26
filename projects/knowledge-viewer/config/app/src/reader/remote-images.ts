// 원격 이미지 보기 상태. 저장은 src/app/prefs/images.ts, 알림은 작은 구독 저장소다 —
// ⚙ 에서 토글·호스트를 바꾸면 열린 리더가 useRemoteImages 로 알아채 다시 그린다(mermaid-theme-prefs.ts 패턴).
// "불러오기" 로 연 주소는 이 탭의 메모리에만 둔다 — 저장하지 않는다.
import { useSyncExternalStore } from 'react';

import { DEFAULT_REMOTE_IMAGE_HOSTS } from '../../shared/image-src.ts';
import { readRemoteImageHosts, readRemoteImages, writeRemoteImageHosts, writeRemoteImages } from '../app/prefs.ts';

export type RemoteImageView = { enabled: boolean; hosts: readonly string[] };

/** 끈 상태. SSR·에이전트 모드가 쓴다. */
export const REMOTE_IMAGES_OFF: RemoteImageView = { enabled: false, hosts: DEFAULT_REMOTE_IMAGE_HOSTS };

type RemoteImageIo = {
  readEnabled: () => boolean;
  readHosts: () => string[];
  writeEnabled: (on: boolean) => void;
  writeHosts: (hosts: readonly string[]) => void;
};

/** 저장소를 만든다. 시험은 가짜 읽기·쓰기를 넣고 SSR 에서도 그 값을 보게(`ssr`) 한다. */
export function createRemoteImageStore(io: RemoteImageIo, opts: { ssr?: boolean } = {}) {
  let current: RemoteImageView | null = null;
  const listeners = new Set<() => void>();
  const get = (): RemoteImageView => (current ??= { enabled: io.readEnabled(), hosts: io.readHosts() });
  const publish = (next: RemoteImageView): void => {
    current = next;
    listeners.forEach((fn) => fn());
  };
  const setHosts = (hosts: readonly string[]): void => {
    io.writeHosts(hosts);
    publish({ ...get(), hosts: [...hosts] });
  };
  return {
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    get,
    /** SSR 값. 앱 저장소는 끔이다(localStorage 가 없다). */
    getServer: opts.ssr === true ? get : (): RemoteImageView => REMOTE_IMAGES_OFF,
    setEnabled(on: boolean): void {
      io.writeEnabled(on);
      publish({ ...get(), enabled: on });
    },
    setHosts,
    resetHosts(): void {
      setHosts(DEFAULT_REMOTE_IMAGE_HOSTS);
    },
  };
}
export type RemoteImageStore = ReturnType<typeof createRemoteImageStore>;

/** 앱의 저장소 — ⚙ 와 리더가 함께 본다. */
export const remoteImageStore: RemoteImageStore = createRemoteImageStore({
  readEnabled: readRemoteImages,
  readHosts: readRemoteImageHosts,
  writeEnabled: writeRemoteImages,
  writeHosts: writeRemoteImageHosts,
});

/** 지금 상태. 바뀌면 다시 그린다. */
export function useRemoteImages(store: RemoteImageStore = remoteImageStore): RemoteImageView {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}

const loaded = new Set<string>();

/** 이 탭에서 "불러오기" 로 연 주소인가. */
export const isRemoteLoaded = (href: string): boolean => loaded.has(href);
export const markRemoteLoaded = (href: string): void => void loaded.add(href);
