// 그래프 크기·굵기·투명도 척도. 순수 모듈이다(DOM·three 를 만지지 않는다).

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 노드 반지름. 연결 수(in+out)의 제곱근에 비례하고 [2, 14] 로 자른다. */
export function radiusOf(deg: number): number {
  return clamp(2 + 1.2 * Math.sqrt(deg), 2, 14);
}

/** 간선 굵기. 두 문서 사이 링크 수(weight)에 비례하고 [0.4, 3] 으로 자른다. */
export function widthOf(weight: number): number {
  return clamp(0.4 * weight, 0.4, 3);
}

const HOP_OPACITY: readonly number[] = [1, 0.95, 0.7, 0.45];

/** 홉별 노드 투명도. 중심에서 멀수록 옅다. 전체 보기(hop -1)는 0.6 이다. */
export function opacityOf(hop: number): number {
  if (hop === -1) return 0.6;
  return HOP_OPACITY[hop] ?? 0.45;
}
