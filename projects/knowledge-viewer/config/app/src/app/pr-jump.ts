// 검색 상자 입력이 PR 번호인가. `123`·`#123`·`pr 123`·`PR#123` 를 받고, 날짜·경로 같은 것은 거른다. 순수.
const PR_JUMP = /^(?:pr)?\s*#?\s*(\d{1,7})$/i;

/** PR 번호면 그 수(1 이상), 아니면 null. */
export function parsePrJump(query: string): number | null {
  const m = PR_JUMP.exec(query.trim());
  if (m === null) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}
