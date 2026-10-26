// 텍스트 파일 보기의 순수 보조 함수. DOM 을 만지지 않는다.
// 응답 모양의 정본은 server/file-view.ts 의 FileViewResponse 다.
import type { DocChange } from '../app/types.ts';

export type FileResponse = {
  path: string;
  size: number;
  text: string;
  truncated: boolean;
  binary: boolean;
  change?: DocChange;
  changeError?: string;
};

export type FileLine = { n: number; text: string };

/** 그릴 조각. 바뀐 줄은 이어진 범위(hunk)마다 한 덩어리 — PR 상세의 이전·다음 변경이 덩어리 단위로 옮긴다. */
export type FileSegment =
  | { kind: 'line'; line: FileLine }
  | { kind: 'hunk'; start: number; end: number; lines: FileLine[] }
  | { kind: 'removed'; afterLine: number; count: number };

/** 본문을 줄로. `\r\n` 의 `\r` 은 뗀다. 끝 줄바꿈 하나는 빈 줄로 세지 않는다. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  if (text.endsWith('\n')) lines.pop();
  return lines;
}

/**
 * 줄과 변경을 조각으로. hunk 는 파일 길이로 자른다(잘린 본문 밖은 버린다). 지운 자리는 afterLine 줄 바로 뒤
 * (0 이면 맨 앞, 파일 끝 뒤면 맨 끝)에 둔다.
 */
export function segmentsOf(lines: string[], change?: DocChange | null): FileSegment[] {
  const n = lines.length;
  const hunks = (change?.hunks ?? []).filter((h) => h.start <= n && h.end >= h.start).slice().sort((a, b) => a.start - b.start);
  const removed = (change?.removed ?? []).slice().sort((a, b) => a.afterLine - b.afterLine);
  const out: FileSegment[] = [];
  let r = 0;
  let h = 0;
  const flushRemoved = (upTo: number): void => {
    while (r < removed.length && removed[r]!.afterLine <= upTo) {
      out.push({ kind: 'removed', afterLine: removed[r]!.afterLine, count: removed[r]!.count });
      r++;
    }
  };
  let i = 1;
  while (i <= n) {
    flushRemoved(i - 1);
    while (h < hunks.length && hunks[h]!.end < i) h++;
    const hk = hunks[h];
    if (hk !== undefined && hk.start <= i) {
      const end = Math.min(hk.end, n);
      out.push({ kind: 'hunk', start: i, end, lines: lines.slice(i - 1, end).map((text, k) => ({ n: i + k, text })) });
      i = end + 1;
      h++;
      continue;
    }
    out.push({ kind: 'line', line: { n: i, text: lines[i - 1]! } });
    i++;
  }
  flushRemoved(Infinity);
  return out;
}

/** 앵커 `L12` 의 줄 번호. 아니면 null. */
export function lineOfAnchor(anchor: string): number | null {
  const m = /^L(\d{1,9})$/.exec(anchor);
  return m === null ? null : Number(m[1]);
}

/** 사람이 읽는 크기. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
