// 지도 데이터를 가져오고, 볼트가 바뀌면 디바운스해 다시 가져와 화면의 지도와 합친다.
// three.js 를 불러오지 않는다 — index 청크에 섞이지 않게 그래프 라이브러리와 떨어져 있다.
// 지도 데이터는 늘 주 색인(서버의 볼트 색인)에서 온다 — /api/graph 는 src 를 받지 않는다. 지금 소스(main·pr)는
// 노드를 눌러 문서를 열 때만 쓴다(App 의 navigate·GraphList 의 href 가 싣는다).
import { useEffect, useRef, useState } from 'react';

import { ApiError, getGraph } from '../app/api.ts';
import type { ChangedEvents } from '../app/events.ts';
import type { GraphQuery, GraphResponse } from '../app/types.ts';
import { mergeGraph } from './merge.ts';
import type { MergeResult } from './merge.ts';

/** 변경 알림이 몰려 와도 이 시간 동안 조용해야 한 번 다시 가져온다. */
const DEBOUNCE_MS = 500;
/** 색인에 들어가지 않는 첫 폴더. 여기서 온 변경은 지도를 바꾸지 않는다. */
const IGNORED = new Set(['raw', 'archive', 'private']);

/** 바뀐 경로가 지도에 닿을 수 있는가. 폴더 이벤트도 오므로 `.md` 여부는 보지 않는다. */
export function shouldRefetch(changedPath: string): boolean {
  return !IGNORED.has(changedPath.split('/')[0] ?? '');
}

/** `res` 는 마지막으로 받은 응답 그대로다(좌표 없는 목록 화면용). */
export type GraphData = { data: MergeResult | null; res: GraphResponse | null; error: string | null; missing: boolean };

export function useGraphData(q: GraphQuery, events: ChangedEvents): GraphData {
  // 호출마다 새 객체가 와도 같은 질의면 다시 가져오지 않는다.
  const key = JSON.stringify(q);
  const [state, setState] = useState<GraphData>({ data: null, res: null, error: null, missing: false });
  const prevRef = useRef<MergeResult | null>(null);
  const versionRef = useRef<number | null>(null);
  // 좌표를 처음부터 놓는 기준(중심 경로, 전체 보기면 '\0all'). 지난번 effect 가 본 값이다.
  const layoutRef = useRef<string | null>(null);

  useEffect(() => {
    const query = JSON.parse(key) as GraphQuery;
    const layoutKey = 'all' in query ? '\0all' : query.center;
    let live = true;
    let seq = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // 새 중심·전체 보기면 옛 좌표를 잇지 않고 처음부터 놓는다. 깊이·허브·펼침만 바뀌면 옛 지도와 합친다
    // (허브를 펼쳐도 있던 노드는 자리를 지킨다). 어느 쪽이든 버전은 비운다 — 질의가 다르면 같은 색인 버전도 다른 응답이다.
    if (layoutRef.current !== layoutKey) {
      layoutRef.current = layoutKey;
      prevRef.current = null;
      setState({ data: null, res: null, error: null, missing: false });
    }
    versionRef.current = null;

    const load = () => {
      const mine = ++seq;
      getGraph(query).then(
        (res) => {
          // 늦게 온 옛 응답은 버린다. mergeGraph 가 옛 노드 객체를 고치므로 순서가 중요하다.
          if (!live || mine !== seq) return;
          // 색인 버전이 그대로면 내용도 그대로다. 앞선 실패 안내만 걷는다.
          if (res.version === versionRef.current) {
            setState((s) => (s.error === null && !s.missing ? s : { ...s, error: null, missing: false }));
            return;
          }
          versionRef.current = res.version;
          const merged = mergeGraph(prevRef.current, res);
          prevRef.current = merged;
          setState({ data: merged, res, error: null, missing: false });
        },
        (e: unknown) => {
          if (!live || mine !== seq) return;
          // 중심 문서가 사라졌다. 마지막 지도는 그대로 두고 안내만 띄운다.
          if (e instanceof ApiError && e.status === 404) setState((s) => ({ ...s, error: null, missing: true }));
          else setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
        },
      );
    };

    load();
    // 숨은 탭에서는 App 이 연결을 닫는다. 다시 열 때 App 이 빈 경로('')로 한 번 알려 주므로 그때 다시 가져온다.
    const unsubscribe = events.subscribe((path) => {
      if (!shouldRefetch(path)) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        load();
      }, DEBOUNCE_MS);
    });
    return () => {
      live = false;
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [key, events]);

  return state;
}
