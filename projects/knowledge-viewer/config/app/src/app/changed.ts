// PR 변경 표시(트리·폴더 목록)의 순수 판정. 화면 없이 시험한다.
import type { ChangedFile } from './types.ts';

export type ChangeStatus = ChangedFile['status'];
/** 볼트 경로 → PR 이 그 파일에 한 일. */
export type ChangedMap = Map<string, ChangeStatus>;

/** `dir` 아래(하위 폴더 포함)에 바뀐 파일이 하나라도 있는가. 루트('')는 아무 변경이나. */
export function changedUnder(changed: ChangedMap | undefined, dir: string): boolean {
  if (changed === undefined || changed.size === 0) return false;
  if (dir === '') return true;
  const prefix = `${dir.replace(/\/+$/, '')}/`;
  for (const path of changed.keys()) if (path.startsWith(prefix)) return true;
  return false;
}

/** 파일 행 배지 글자: 더함 `+`, 고침·이름 바꿈 `Δ`, 지움 `−`. */
export function deltaOf(status: ChangeStatus): string {
  if (status === 'A') return '+';
  if (status === 'D') return '−';
  return 'Δ';
}

/** PR 변경 목록 → 지도. */
export function changedMapOf(files: ChangedFile[]): ChangedMap {
  return new Map(files.map((f) => [f.path, f.status]));
}
