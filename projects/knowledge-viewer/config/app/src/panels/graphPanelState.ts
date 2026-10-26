// 연결 지도 패널의 표시 상태. 순수 모듈이다 — 브라우저·그래프 라이브러리 없이 불러 시험한다.
import type { GraphResponse } from '../app/types.ts';
import type { MergeResult } from '../graph/merge.ts';

export type PanelStateInput = { data: MergeResult | null; res: GraphResponse | null; path: string; missing: boolean; error: string | null };
/** current: 지금 중심의 결과인가. notice: 캔버스 위 안내문(없으면 null). count: 1홉 이웃 수(중심 제외). */
export type PanelState = { current: boolean; notice: string | null; count: number };

export function panelState({ data, res, path, missing, error }: PanelStateInput): PanelState {
  // 중심이 바뀐 직후 한 번은 옛 중심의 결과가 남아 있다. 응답의 중심이 지금 경로이고 그 노드가 있어야 지금 결과다.
  const current = data !== null && res !== null && res.center === path && data.nodes.some((n) => n.path === path);
  // 안내문 순서: 중심 없음 > 오류 > 불러오는 중.
  const notice = missing ? '중심 문서가 없다' : error !== null ? error : current ? null : '불러오는 중…';
  const count = current && data !== null ? Math.max(0, data.nodes.length - 1) : 0;
  return { current, notice, count };
}
