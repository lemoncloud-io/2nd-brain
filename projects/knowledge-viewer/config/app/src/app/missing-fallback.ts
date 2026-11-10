// git 소스에 없는 문서·폴더에서 떨어질 곳을 찾는다. 목록 함수를 받아 서버 없이 시험한다.
import { ApiError } from './api.ts';

/** 경로의 윗 폴더. 루트('')의 윗 폴더는 없다(null). */
export function parentDir(dir: string): string | null {
  if (dir === '') return null;
  return dir.split('/').slice(0, -1).join('/');
}

/** 그 소스에 없는 경로라는 오류인가(404). 다른 오류는 진짜 오류다. */
export const isNotFound = (e: unknown): boolean => e instanceof ApiError && e.status === 404;

/**
 * `start` 부터 위로 올라가며 그 소스에 실제로 있는 가장 가까운 폴더를 찾는다. 층마다 `list` 한 번이다.
 * 찾으면 그 폴더와 받은 목록을 돌려준다(착지한 곳이 다시 받지 않게). 루트까지 없으면 루트('')에 목록 없이(null) 선다 —
 * 루트 위로는 가지 않는다. 404 밖의 오류는 삼키지 않고 그대로 던진다.
 * `alive` 가 거짓이 되면(주소가 바뀜) 다음 층으로 가지 않고 null 을 돌려준다.
 */
export async function nearestFolder<T>(
  start: string,
  list: (dir: string) => Promise<T>,
  alive: () => boolean = () => true,
): Promise<{ dir: string; listing: T | null } | null> {
  let dir: string | null = start;
  while (dir !== null) {
    if (!alive()) return null;
    try {
      const listing = await list(dir);
      return alive() ? { dir, listing } : null;
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
    dir = parentDir(dir);
  }
  return alive() ? { dir: '', listing: null } : null;
}
