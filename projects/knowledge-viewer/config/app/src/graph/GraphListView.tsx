// 에이전트 모드 지도: 데이터를 받아(SSE 로 갱신) 텍스트 목록에 넘긴다.
// useGraphData 를 App 이 아니라 여기서 불러야 일반 화면에서 훅이 돌지 않는다.
import { useContext } from 'react';

import type { Source } from '../../shared/source.ts';
import { ChangedEventsContext } from '../app/events.ts';
import type { GraphQuery } from '../app/types.ts';
import { GraphList } from './GraphList.tsx';
import { useGraphData } from './useGraphData.ts';

type Props = { center: string; depth: number; hubs: 'keep' | 'expand'; all: boolean; src: Source };

export function GraphListView({ center, depth, hubs, all, src }: Props) {
  const events = useContext(ChangedEventsContext);
  const query: GraphQuery = all ? { all: true } : { center, depth, hubs, expand: [] };
  const { res, error, missing } = useGraphData(query, events);
  if (missing) return <p className="notice">중심 문서가 없다: {center}</p>;
  if (error !== null) return <p className="notice">{error}</p>;
  if (res === null) return <p className="notice">불러오는 중…</p>;
  return <GraphList data={res} src={src} />;
}
