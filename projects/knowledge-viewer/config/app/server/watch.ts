// 파일 감시. fs.watch(재귀)로 볼트 변경을 받아 색인을 고치고 onChange로 알린다.
// gitignore를 거르는 곳은 여기다 — VaultIndex.update는 lint 범위만 보고 gitignore는 보지 않는다.
import fs from 'node:fs';
import path from 'node:path';

import { EXCLUDED_DIRS, EXCLUDED_TOP, gitIgnored, walkDisk } from '../shared/scope.ts';
import type { VaultIndex } from './index-store.ts';

export type WatchOptions = { debounceMs?: number; includePrivate?: boolean };

/** 이벤트 경로를 볼트 상대 POSIX 경로로 바꾼다. 볼트 밖이거나 비었으면 null이다. */
function normalize(filename: string): string | null {
  let p = filename.split(path.sep).join('/');
  while (p.startsWith('./')) p = p.slice(2);
  if (p === '' || p === '.' || p.startsWith('/') || p.split('/').includes('..')) return null;
  return p;
}

export function startWatch(root: string, index: VaultIndex, onChange: (path: string) => void, opts: WatchOptions = {}): () => void {
  const debounceMs = opts.debounceMs ?? 200;
  const timers = new Map<string, NodeJS.Timeout>();
  let stopped = false;

  const exists = (p: string): boolean => {
    try {
      return fs.statSync(path.join(root, p)).isFile();
    } catch {
      return false;
    }
  };

  const isDir = (p: string): boolean => {
    try {
      return fs.lstatSync(path.join(root, p)).isDirectory();
    } catch {
      return false;
    }
  };

  /**
   * 폴더 이름 바꾸기·옮기기는 폴더 경로 하나의 이벤트로만 올 수 있다. 그 아래를 디스크와 맞춘다 —
   * 색인에 있는데 디스크에 없는 것은 빼고, 지금 폴더면 그 아래 lint 범위 md를 넣는다.
   */
  const reconcile = (p: string): void => {
    const prefix = p + '/';
    for (const f of [...index.files]) {
      if (f.startsWith(prefix) && !exists(f)) index.remove(f);
    }
    if (EXCLUDED_TOP.includes(p.split('/')[0] ?? '') || !isDir(p)) return;
    // 이미 색인된 파일은 제 이벤트로 고쳐진다. 새로 나타난 것만 넣는다(폴더 한 층 이벤트마다 다시 읽지 않게).
    const fresh = walkDisk(path.join(root, p), { includePrivate: true })
      .filter((rel) => rel.endsWith('.md'))
      .map((rel) => prefix + rel)
      .filter((f) => !index.files.has(f) && !f.split('/').some((s) => EXCLUDED_DIRS.has(s)));
    const ignored = gitIgnored(root, fresh);
    for (const f of fresh) if (!ignored.has(f)) index.update(f);
  };

  const settle = (p: string): void => {
    if (stopped) return;
    const segs = p.split('/');
    const top = segs[0] ?? '';
    try {
      // md 중 lint 범위(raw·archive·private 밖)만 색인을 고친다. 그 밖은 알리기만 한다.
      if (p.endsWith('.md') && !EXCLUDED_TOP.includes(top)) {
        if (!exists(p)) {
          index.remove(p);
          // `x.md` 라는 이름의 폴더일 수도 있다.
          if (isDir(p)) reconcile(p);
        } else if (gitIgnored(root, [p]).has(p)) index.remove(p);
        else index.update(p);
      } else if (!p.endsWith('.md')) {
        reconcile(p);
      }
    } catch (e) {
      console.error(e);
    }
    onChange(p);
  };

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      if (stopped || filename === null || filename === undefined) return;
      const p = normalize(String(filename));
      if (p === null) return;
      const segs = p.split('/');
      if (segs.some((s) => EXCLUDED_DIRS.has(s))) return;
      if (segs[0] === 'private' && !opts.includePrivate) return;
      const old = timers.get(p);
      if (old) clearTimeout(old);
      timers.set(
        p,
        setTimeout(() => {
          timers.delete(p);
          settle(p);
        }, debounceMs),
      );
    });
    watcher.on('error', (e) => console.error(`파일 감시 오류: ${e.message}`));
  } catch (e) {
    console.error(`파일 감시를 쓸 수 없다(재귀 감시 미지원): ${e instanceof Error ? e.message : String(e)}`);
    return () => {};
  }

  return () => {
    stopped = true;
    watcher.close();
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  };
}
