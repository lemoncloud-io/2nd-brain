/**
 * 목차 스크롤 스파이의 "지금 읽는 절" 판정. DOM 없이 수만 받는다 — 위치 재기·스크롤 묶기는 useActiveHeading 몫이다.
 *
 * 규칙: 뷰포트 위쪽 기준선(스크롤 top + offset)을 지나간 마지막 헤딩.
 * - 맨 위(scrollTop ≤ 1)에서는 첫 헤딩(같은 위치 헤딩이 겹치면 그중 뒤의 것).
 * - 문서 끝(스크롤이 바닥)에서는 마지막 헤딩. 스크롤이 생기지 않는 짧은 문서는 바닥 규칙을 쓰지 않는다.
 * - 같은 위치 헤딩이 여럿이면 뒤의 것.
 * - 아무것도 안 지났으면 첫 헤딩. 헤딩이 없으면 -1.
 */
export type ScrollBox = {
  /** 스크롤 컨테이너의 scrollTop. */
  scrollTop: number;
  /** 보이는 높이(clientHeight). */
  viewport: number;
  /** 내용 전체 높이(scrollHeight). */
  content: number;
};

/** 기준선이 뷰포트 위에서 내려온 거리(px). 헤딩이 이만큼 안쪽으로 들어오면 그 절을 읽는 중으로 본다. */
export const TOC_ACTIVE_OFFSET = 80;

/** 바닥 판정 여유(px). 소수점 스크롤·줌에서 1~2px 모자라는 일이 있다. */
const BOTTOM_SLACK = 2;

/** tops 는 헤딩마다 스크롤 내용 안의 세로 위치(문서 순서). 잴 수 없는 헤딩은 NaN — 판정에서 빠진다. */
export function activeHeadingIndex(tops: readonly number[], box: ScrollBox, offset = TOC_ACTIVE_OFFSET): number {
  let first = -1;
  let last = -1;
  let minTop = Infinity;
  for (let i = 0; i < tops.length; i++) {
    const t = tops[i]!;
    if (Number.isNaN(t)) continue;
    if (first === -1) first = i;
    last = i;
    if (t < minTop) minTop = t;
  }
  if (first === -1) return -1;

  const scrollable = box.content - box.viewport > 1;
  if (scrollable && box.scrollTop + box.viewport >= box.content - BOTTOM_SLACK) return last;

  const baseline = box.scrollTop <= 1 ? Math.min(box.scrollTop + offset, minTop) : box.scrollTop + offset;
  let found = -1;
  for (let i = first; i <= last; i++) {
    const t = tops[i]!;
    if (!Number.isNaN(t) && t <= baseline) found = i;
  }
  return found === -1 ? first : found;
}
