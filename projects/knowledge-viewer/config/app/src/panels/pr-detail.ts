// PR 상세 패널의 순수 보조 함수. DOM 을 만지지 않는다.

/**
 * 다음·이전 변경 블록의 번호. `positions` 는 문서 순서(오름차순) 위치, `current` 는 지금 기준 위치다.
 * 다음(1)은 `current` 보다 뒤인 첫 블록, 이전(-1)은 앞인 마지막 블록이고 끝에서 순환한다. 빈 목록은 -1.
 */
export function nextChangedIndex(positions: number[], current: number, dir: 1 | -1): number {
  const n = positions.length;
  if (n === 0) return -1;
  if (dir === 1) {
    const i = positions.findIndex((p) => p > current);
    return i === -1 ? 0 : i;
  }
  for (let i = n - 1; i >= 0; i--) if (positions[i]! < current) return i;
  return n - 1;
}
