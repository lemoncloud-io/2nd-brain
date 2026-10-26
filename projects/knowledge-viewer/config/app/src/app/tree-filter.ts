// 트리 필터. 제목 목록(/api/titles)에서 질의에 맞는 문서와 그 상위 폴더만 남긴 가상 트리를 만든다. 순수 함수다.
import { rankTitles, type Range, type TitleItem } from './title-match.ts';

export type FilteredFile = { path: string; name: string; title: string; ranges: Range[] };
export type FilteredDir = { path: string; name: string; dirs: FilteredDir[]; files: FilteredFile[] };
export type FilteredTree = { total: number; shown: number; root: FilteredDir };

const nameOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
const byName = <T extends { name: string }>(a: T, b: T): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** 맞는 문서가 limit 보다 많으면 점수 순으로 자른다(total 은 전체 수). 폴더·파일은 이름순이다. */
export function filterTree(query: string, items: readonly TitleItem[], limit: number): FilteredTree {
  const all = rankTitles(query, items, Number.MAX_SAFE_INTEGER);
  const hits = all.slice(0, limit);
  const root: FilteredDir = { path: '', name: '', dirs: [], files: [] };
  const dirs = new Map<string, FilteredDir>([['', root]]);
  const dirFor = (p: string): FilteredDir => {
    const hit = dirs.get(p);
    if (hit) return hit;
    const parent = dirFor(p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
    const d: FilteredDir = { path: p, name: nameOf(p), dirs: [], files: [] };
    parent.dirs.push(d);
    dirs.set(p, d);
    return d;
  };
  for (const h of hits) {
    const parent = dirFor(h.path.includes('/') ? h.path.slice(0, h.path.lastIndexOf('/')) : '');
    parent.files.push({ path: h.path, name: nameOf(h.path), title: h.title, ranges: h.titleRanges });
  }
  for (const d of dirs.values()) {
    d.dirs.sort(byName);
    d.files.sort(byName);
  }
  return { total: all.length, shown: hits.length, root };
}
