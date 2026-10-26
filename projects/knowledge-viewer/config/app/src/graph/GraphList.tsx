// 에이전트 모드의 지도: 캔버스 대신 홉별 텍스트 목록. 항목마다 data-vault-path 를 달아 read_page/find 가 집어 간다.
import type { Source } from '../../shared/source.ts';
import { hrefFor } from '../app/route.ts';
import type { GraphNode, GraphResponse } from '../app/types.ts';
import { groupByHop, weightTo } from './groupByHop.ts';

/** `src` 는 항목 링크가 싣는 지금 소스다. 지도 데이터 자체는 소스와 무관하다(주 색인). */
export function GraphList({ data, src }: { data: GraphResponse; src: Source }) {
  const { center, hops } = groupByHop(data);
  return (
    <section className="graph-list" data-graph-center={center?.path ?? ''}>
      {center !== null && (
        <p data-vault-path={center.path}>
          {`중심: ${center.title} (${center.path}) · ${center.kind} · 들어옴 ${center.in} · 나감 ${center.out}`}
        </p>
      )}
      {hops.map((g) => (
        <div key={g.hop}>
          <h3>{g.hop < 0 ? `전체 (${g.nodes.length})` : `${g.hop}홉 (${g.nodes.length})`}</h3>
          <ul>
            {g.nodes.map((n) => (
              <li key={n.path} data-vault-path={n.path}>
                <a href={hrefFor(n.path, undefined, true, src)}>{n.title}</a>
                {` (${n.path}) · ${n.kind}${weightText(weightTo(data, n.path))}${marker(n)}`}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** 중심과 직접 잇지 않은(가중치 0) 노드는 가중치를 적지 않는다. */
function weightText(w: number): string {
  return w > 0 ? ` · 가중치 ${w}` : '';
}

/** 허브는 "허브", 펼칠 수 있는(허브가 아닌데 응답 밖 이웃이 남은) 노드는 "더 있음". */
function marker(n: GraphNode): string {
  return n.hub ? ' · 허브' : n.truncated ? ' · 더 있음' : '';
}
