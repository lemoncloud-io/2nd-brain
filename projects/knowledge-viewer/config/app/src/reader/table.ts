// 표 보기의 순수 도우미. React·DOM 없이 돈다.

/** 짧은 셀의 코드 포인트 상한. 이 이하면 한 줄(nowrap)로 그린다. "active"·날짜·버전 같은 값이 들어온다. */
export const SHORT_CELL_MAX = 12;

/** 양끝 공백을 뺀 코드 포인트 수가 상한 이하이면 짧은 셀이다. UTF-16 단위가 아니라 코드 포인트로 센다. */
export function isShortCell(text: string): boolean {
  return [...text.trim()].length <= SHORT_CELL_MAX;
}

export type HastNode = { type: string; value?: string; children?: HastNode[] };

/** hast 노드의 텍스트를 이어 붙인다. 없으면 빈 문자열이다. */
export function hastText(node: HastNode | undefined): string {
  if (node === undefined) return '';
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(hastText).join('');
}

/** 행 상세용 짝. 셀 순서대로 헤더를 붙이고, 헤더가 모자라면 null 이다(화면이 `열 N` 으로 채운다). */
export function pairRow<T>(headers: T[], cells: T[]): Array<{ head: T | null; cell: T }> {
  return cells.map((cell, i) => ({ head: i < headers.length ? headers[i] : null, cell }));
}
