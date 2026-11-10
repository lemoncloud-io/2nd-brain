// 지금 보는 볼트가 어느 체크아웃·브랜치인지. git 이 없거나 저장소가 아니면 null 값으로 답한다.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type VaultInfo = {
  /** 볼트 루트 폴더 이름(절대경로는 보내지 않는다 — 머신 종속·개인 경로) */
  name: string;
  branch: string | null;
  head: string | null;
  /** git worktree 인가(.git 이 파일이고 공용 git-dir 이 다른 곳) */
  worktree: boolean;
  /** 추적 파일 중 바뀐 것이 있는가 */
  dirty: boolean;
};

function git(root: string, args: string[]): string | null {
  try {
    const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 5_000 });
    if (r.error || r.status !== 0) return null;
    return r.stdout.trim();
  } catch {
    return null;
  }
}

/**
 * 볼트 루트 폴더의 지문 — 장치·inode 번호의 sha256 앞 16자. 같은 머신에서 "같은 폴더인가"만 견준다.
 * 경로(사용자 이름이 든)에서 만들지 않으므로 경로를 알려 주지 않는다. 심링크·다른 철자로 와도 같은 폴더면 같은 값이다(realpath 비교와 같다).
 */
export function rootId(root: string): string {
  const s = fs.statSync(root, { bigint: true });
  return createHash('sha256').update(`${s.dev}:${s.ino}`).digest('hex').slice(0, 16);
}

export function vaultInfo(root: string): VaultInfo {
  const name = path.basename(root);
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = git(root, ['rev-parse', '--short', 'HEAD']);
  const gitDir = git(root, ['rev-parse', '--git-dir']);
  const common = git(root, ['rev-parse', '--git-common-dir']);
  const worktree = gitDir !== null && common !== null && path.resolve(root, gitDir) !== path.resolve(root, common);
  const status = git(root, ['status', '--porcelain', '--untracked-files=no']);
  return { name, branch, head, worktree, dirty: status !== null && status !== '' };
}
