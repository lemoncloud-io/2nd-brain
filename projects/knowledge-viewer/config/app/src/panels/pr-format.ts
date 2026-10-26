// PR 패널의 순수 보조 함수. DOM 을 만지지 않는다.
import type { PrFile } from '../app/types.ts';

/** 바뀐 파일을 리더로 열 수 있는 md, 체크아웃에 없는 md, 그 밖(개수) 로 나눈다. 경로순이다. */
export function splitFiles(files: PrFile[]): { viewable: PrFile[]; missing: PrFile[]; otherCount: number } {
  const byPath = (a: PrFile, b: PrFile): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const md = files.filter((f) => f.md);
  return {
    viewable: md.filter((f) => f.viewable).sort(byPath),
    missing: md.filter((f) => !f.viewable).sort(byPath),
    otherCount: files.length - md.length,
  };
}

/** "방금"·"N분 전"·"N시간 전"(같은 날)·"어제"·YYYY-MM-DD(현지 날짜). 못 읽는 값은 빈 문자열. */
export function formatUpdated(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 60) return '방금';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const d = new Date(t);
  const n = new Date(now);
  const dayStart = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((dayStart(n) - dayStart(d)) / 86_400_000);
  const hour = Math.floor(min / 60);
  if (hour < 24 && dayDiff === 0) return `${hour}시간 전`;
  if (dayDiff === 1) return '어제';
  const pad = (v: number): string => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
