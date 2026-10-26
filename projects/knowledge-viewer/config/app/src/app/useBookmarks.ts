// 북마크 공유 상태. 상단 아이콘·트리·패널이 같은 목록을 보도록 모듈 하나가 들고, 바뀌면 구독자에게 알린다.
import { useCallback, useSyncExternalStore } from 'react';

import { BOOKMARKS_KEY, loadBookmarks, saveBookmarks, toggleBookmark, removeBookmark, type Bookmark } from './bookmarks.ts';

let list: Bookmark[] = loadBookmarks();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function set(next: Bookmark[]) {
  list = next;
  saveBookmarks(next);
  emit();
}

// 다른 탭에서 바꾸면 따라간다.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === BOOKMARKS_KEY) {
      list = loadBookmarks();
      emit();
    }
  });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const get = () => list;

export function useBookmarks() {
  const items = useSyncExternalStore(subscribe, get, get);
  const toggle = useCallback((path: string, title: string) => set(toggleBookmark(list, path, title)), []);
  const remove = useCallback((path: string) => set(removeBookmark(list, path)), []);
  return { items, toggle, remove };
}
