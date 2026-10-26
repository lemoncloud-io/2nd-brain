// 다시 데울 때의 노드 고정(순수). 중심은 원점에 늘 고정한다. 같은 중심에서 집합만 바뀌면 남은 노드를 지금 자리에
// 잠시 고정해 흔들리지 않게 하고(새 노드만 자리를 찾는다), 레이아웃이 멈추면 releasePins 로 푼다.
import type { Positioned } from './merge.ts';

/**
 * 그리기 전에 고정을 건다. pinned 는 우리가 건 고정의 경로 모음이다(여기서 고친다).
 * - sameCenter: 지난번과 같은 중심(전체 보기는 '')에 이어 그린다. 거짓이면 처음부터 놓는다 — 고정을 모두 걷는다.
 * - reheat: 집합이 바뀌었다. 참이면 남은 노드(survivors 에 있고 좌표가 있는 노드)를 지금 자리에 고정한다.
 *   거짓(가중치만 바뀜)이면 앞서 건 고정을 그대로 둔다 — 레이아웃이 아직 돌고 있을 수 있다.
 * 고정은 여러 번 해도 같다 — 멈추기 전에 또 바뀌면 그때 자리에 다시 고정한다.
 */
export function applyPins(
  nodes: readonly Positioned[],
  center: string,
  survivors: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  o: { sameCenter: boolean; reheat: boolean },
  pinned: Set<string>,
): void {
  const pinSurvivors = o.sameCenter && o.reheat;
  const keepPins = o.sameCenter && !o.reheat;
  if (!o.sameCenter) pinned.clear();
  for (const n of nodes) {
    if (n.path === center) {
      n.fx = 0;
      n.fy = 0;
      n.fz = 0;
    } else if (pinSurvivors && survivors.has(n.path) && n.x !== undefined && n.y !== undefined) {
      n.fx = n.x;
      n.fy = n.y;
      if (n.z !== undefined) n.fz = n.z;
      pinned.add(n.path);
    } else if (n.fx !== undefined && !(keepPins && pinned.has(n.path))) {
      // 중심에서 내려온 노드, 앞서 고정했던 노드는 다시 풀어 준다.
      delete n.fx;
      delete n.fy;
      delete n.fz;
      pinned.delete(n.path);
    }
  }
}

/** 레이아웃이 멈췄다. 우리가 건 고정만 푼다 — 중심의 원점 고정은 둔다. */
export function releasePins(nodes: readonly Positioned[], center: string, pinned: Set<string>): void {
  if (pinned.size === 0) return;
  for (const n of nodes) {
    if (n.path === center || !pinned.has(n.path)) continue;
    delete n.fx;
    delete n.fy;
    delete n.fz;
  }
  pinned.clear();
}
