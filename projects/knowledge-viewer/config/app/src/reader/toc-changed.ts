// 목차 점의 순수 계산. 헤딩의 "절"은 그 줄부터 다음 같은·얕은 깊이 헤딩 바로 앞 줄까지(없으면 문서 끝)다.
// 줄 번호는 파일 전체 기준(frontmatter 포함) — doc.headings·change.hunks 와 같다.

type Range = { start: number; end: number };
type Removed = { afterLine: number; count: number };

/**
 * 절이 바뀐 헤딩의 번호(headings 의 index). 절이 hunk 와 겹치거나, 지운 자리(afterLine — 그 줄 뒤를 지웠다)가
 * 절 안에 있으면 바뀐 것이다. 중첩된 절의 변경은 그 위 절에도 잡힌다.
 */
export function changedHeadings(headings: { depth: number; line: number }[], hunks: Range[], removed: Removed[], endLine: number): Set<number> {
  const out = new Set<number>();
  headings.forEach((h, i) => {
    let next = headings.length;
    for (let j = i + 1; j < headings.length; j += 1) {
      if (headings[j]!.depth <= h.depth) {
        next = j;
        break;
      }
    }
    const start = h.line;
    const end = next < headings.length ? headings[next]!.line - 1 : Math.max(endLine, start);
    const hit = hunks.some((r) => r.start <= end && r.end >= start) || removed.some((r) => start <= r.afterLine && r.afterLine <= end);
    if (hit) out.add(i);
  });
  return out;
}

/** 문서 마지막 줄 번호(파일 기준): 본문 줄 수 + bodyStartLine - 1. 끝 줄바꿈 뒤의 빈 조각은 줄로 세지 않는다. */
export function docEndLine(body: string, bodyStartLine: number): number {
  const parts = body.split('\n');
  const lines = parts.at(-1) === '' ? parts.length - 1 : parts.length;
  return lines + bodyStartLine - 1;
}
