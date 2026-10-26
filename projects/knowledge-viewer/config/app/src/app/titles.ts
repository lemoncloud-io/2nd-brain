// 제목 목록(/api/titles) 저장소. 처음 쓸 때 한 번 받고, 색인이 바뀌었다는 SSE 가 오면 다시 받는다.
// 검색 상자와 트리가 같은 목록을 보도록 모듈 하나에 둔다. 매칭에 바로 쓰게 미리 푼(prepareTitle) 형태로 든다.
import { useContext, useEffect, useSyncExternalStore } from 'react';

import { getTitles } from './api.ts';
import { ChangedEventsContext } from './events.ts';
import { prepareTitle, type PreparedTitle } from './title-match.ts';
import type { TitleItem } from './types.ts';

export type TitlesState = {
  /** 받은 목록. 아직이면 null. */
  items: PreparedTitle[] | null;
  state: 'idle' | 'loading' | 'error';
};

export type TitlesFetcher = () => Promise<{ items: TitleItem[] }>;

/** 저장소 본체. 시험은 fetcher 를 바꿔 끼운다. */
export function createTitlesStore(fetcher: TitlesFetcher, refreshDelayMs = 1000) {
  let snap: TitlesState = { items: null, state: 'idle' };
  const listeners = new Set<() => void>();
  let inflight: Promise<void> | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const set = (next: TitlesState): void => {
    snap = next;
    for (const l of [...listeners]) l();
  };
  const load = (): Promise<void> => {
    if (inflight !== null) return inflight;
    set({ items: snap.items, state: 'loading' });
    inflight = fetcher().then(
      (r) => {
        inflight = null;
        set({ items: r.items.map(prepareTitle), state: 'idle' });
      },
      () => {
        inflight = null;
        set({ items: snap.items, state: 'error' });
      },
    );
    return inflight;
  };
  return {
    get: (): TitlesState => snap,
    subscribe(l: () => void): () => void {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    /** 아직 없으면(또는 실패했으면) 받는다. 있으면 아무것도 안 한다. */
    ensure(): void {
      if (snap.items === null && inflight === null) void load();
    },
    /** 색인이 바뀌었다. 받아 둔 목록이 있을 때만, 잠시 모아서 다시 받는다. */
    invalidate(): void {
      if (snap.items === null) return;
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void load();
      }, refreshDelayMs);
    },
    /** 시험용: 받는 중인 요청을 기다린다. */
    settled: (): Promise<void> => inflight ?? Promise.resolve(),
  };
}

export const titlesStore = createTitlesStore(getTitles);

/**
 * 제목 목록 훅. active 가 참이 되는 순간 받고, 그 뒤 파일 변경 알림마다(모아서) 다시 받는다.
 * 받기 전에는 items 가 null 이다 — 부르는 쪽이 "불러오는 중" 을 그린다.
 */
export function useTitles(active: boolean): TitlesState {
  const events = useContext(ChangedEventsContext);
  const snap = useSyncExternalStore(titlesStore.subscribe, titlesStore.get, titlesStore.get);
  useEffect(() => {
    if (active) titlesStore.ensure();
  }, [active]);
  useEffect(() => events.subscribe(() => titlesStore.invalidate()), [events]);
  return snap;
}
