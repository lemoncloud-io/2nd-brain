// 문서 북마크. 순수 모듈 — storage 는 인자로 받고, 브라우저(localStorage)에만 남는다. 볼트에는 적지 않는다.
export type Bookmark = { path: string; title: string; addedAt: number };

export const BOOKMARKS_KEY = 'knowledge-viewer.bookmarks';

const isBookmark = (v: unknown): v is Bookmark =>
  typeof v === 'object' && v !== null && typeof (v as Bookmark).path === 'string' && typeof (v as Bookmark).title === 'string';

/** 저장된 값을 정리한다. 모양이 틀리거나 경로가 겹치면 버린다. */
export function normalizeBookmarks(raw: unknown): Bookmark[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Bookmark[] = [];
  for (const v of raw) {
    if (!isBookmark(v) || v.path === '' || seen.has(v.path)) continue;
    seen.add(v.path);
    out.push({ path: v.path, title: v.title, addedAt: typeof v.addedAt === 'number' ? v.addedAt : 0 });
  }
  return out;
}

export function isBookmarked(list: Bookmark[], path: string): boolean {
  return list.some((b) => b.path === path);
}

/** 있으면 빼고 없으면 앞에 더한다(최근 것이 위). 새 배열을 돌려준다. */
export function toggleBookmark(list: Bookmark[], path: string, title: string, now = Date.now()): Bookmark[] {
  return isBookmarked(list, path) ? list.filter((b) => b.path !== path) : [{ path, title, addedAt: now }, ...list];
}

export function removeBookmark(list: Bookmark[], path: string): Bookmark[] {
  return list.filter((b) => b.path !== path);
}

const defaultStorage = (): Storage | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

export function loadBookmarks(storage: Pick<Storage, 'getItem'> | undefined = defaultStorage()): Bookmark[] {
  if (!storage) return [];
  try {
    const text = storage.getItem(BOOKMARKS_KEY);
    return normalizeBookmarks(text === null ? null : JSON.parse(text));
  } catch {
    return [];
  }
}

export function saveBookmarks(list: Bookmark[], storage: Pick<Storage, 'setItem'> | undefined = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(BOOKMARKS_KEY, JSON.stringify(list));
  } catch {
    // 저장소가 막혀 있으면 이 세션 안에서만 산다
  }
}

/** 보여 줄 순서 — 최근 추가한 것이 위. 같은 시각이면 들어온 순서를 지킨다. 새 배열을 돌려준다. */
export function sortBookmarks(list: Bookmark[]): Bookmark[] {
  return list.map((b, i) => ({ b, i })).sort((x, y) => y.b.addedAt - x.b.addedAt || x.i - y.i).map(({ b }) => b);
}

/** 행에 쓸 이름 — 제목이 비면 파일 이름. */
export function bookmarkLabel(b: Pick<Bookmark, 'path' | 'title'>): string {
  const title = b.title.trim();
  if (title !== '') return title;
  const name = b.path.split('/').pop() ?? b.path;
  return name === '' ? b.path : name;
}
