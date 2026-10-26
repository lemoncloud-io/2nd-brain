// 커뮤니티 탐지 — 라벨 전파(label propagation). 순수 모듈이다.
//
// 왜 라벨 전파인가: 물리 엔진 설계(#933)가 정했다 — Girvan–Newman 은 간선 9천 개에서 요청마다 돌릴 수 없고, 라벨 전파는 간선 수에
// 선형이다. 결과는 **위치(클러스터 힘)에만** 쓴다. 색은 문서 종류라는 오너 결정과 충돌하지 않게.
//
// 규칙(결정적 — 같은 지도는 새로고침해도 같은 그림):
// - 노드는 경로순으로 돌고, 이웃의 라벨에 표를 준다. 표의 무게 = 간선 가중치 / √(이웃의 연결 수). 허브(INDEX·폴더 README)의 표는
//   이렇게 희석된다 — 안 그러면 INDEX 에 닿은 모든 문서가 INDEX 하나로 뭉친다. 사전순 동점 규칙은 다리 하나로 이어진 두 덩어리를
//   사전순이 작은 쪽으로 합쳐 버렸다(2026-10-23 시험).
// - 지금 라벨이 1위(공동 포함)면 둔다(흔들림 방지). 아니면 1위 라벨 가운데 주인의 연결 수가 작은(또래) 라벨, 그다음 경로순.
// - 변화가 없거나 MAX_ROUNDS 면 멈춘다. 커뮤니티 id 는 구성원 가운데 가장 작은 경로다.

export type CommunityLink = { source: string; target: string; weight?: number };

export const MAX_ROUNDS = 30;

/** 각 노드의 커뮤니티 id(그 커뮤니티에서 경로가 가장 작은 노드의 경로). 간선이 없는 노드는 자기 자신이다. */
export function labelPropagation(paths: readonly string[], links: readonly CommunityLink[], maxRounds = MAX_ROUNDS): Map<string, string> {
  const order = [...paths].sort();
  const label = new Map<string, string>(order.map((p) => [p, p]));
  const nbrs = new Map<string, { to: string; w: number }[]>();
  const degree = new Map<string, number>();
  for (const l of links) {
    if (!label.has(l.source) || !label.has(l.target) || l.source === l.target) continue;
    const w = l.weight === undefined || !(l.weight > 0) ? 1 : l.weight;
    (nbrs.get(l.source) ?? nbrs.set(l.source, []).get(l.source)!).push({ to: l.target, w });
    (nbrs.get(l.target) ?? nbrs.set(l.target, []).get(l.target)!).push({ to: l.source, w });
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  const deg = (p: string): number => degree.get(p) ?? 0;
  for (let round = 0; round < maxRounds; round += 1) {
    let changed = false;
    for (const p of order) {
      const ns = nbrs.get(p);
      if (ns === undefined || ns.length === 0) continue;
      const score = new Map<string, number>();
      for (const n of ns) {
        const lb = label.get(n.to)!;
        score.set(lb, (score.get(lb) ?? 0) + n.w / Math.sqrt(deg(n.to)));
      }
      const mine = label.get(p)!;
      let top = -Infinity;
      for (const v of score.values()) if (v > top) top = v;
      // 부동소수 합의 순서 오차를 동점으로 본다.
      const tied = (v: number): boolean => Math.abs(v - top) <= 1e-9;
      let best = mine;
      if (!tied(score.get(mine) ?? -Infinity)) {
        best = '';
        let bestDeg = Infinity;
        for (const [lb, v] of score) {
          if (!tied(v)) continue;
          const d = deg(lb);
          if (best === '' || d < bestDeg || (d === bestDeg && lb < best)) {
            best = lb;
            bestDeg = d;
          }
        }
      }
      if (best !== mine) {
        label.set(p, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // 커뮤니티 id 를 그 안에서 가장 작은 경로로 정규화한다 — 전파 중 라벨은 "처음 그 라벨을 가졌던 노드"라 구성원이 아닐 수 있다.
  const members = new Map<string, string[]>();
  for (const [p, lb] of label) (members.get(lb) ?? members.set(lb, []).get(lb)!).push(p);
  const out = new Map<string, string>();
  for (const ps of members.values()) {
    const id = [...ps].sort()[0]!;
    for (const p of ps) out.set(p, id);
  }
  return out;
}

/** 커뮤니티별 구성원 수. */
export function communitySizes(community: ReadonlyMap<string, string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of community.values()) out.set(id, (out.get(id) ?? 0) + 1);
  return out;
}

/** 커뮤니티 수(구성원 2 이상인 것만 — 혼자는 묶음이 아니다). */
export function communityCount(community: ReadonlyMap<string, string>): number {
  let n = 0;
  for (const size of communitySizes(community).values()) if (size >= 2) n += 1;
  return n;
}
