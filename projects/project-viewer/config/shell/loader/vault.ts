// 볼트 루트 탐색과 경로 안전성. 파일 시스템을 만지는 것은 이 파일뿐이다.
import fs from 'node:fs';
import path from 'node:path';

const MARKER = 'VAULT_RULES.md';

/** 위로 올라가며 VAULT_RULES.md를 찾는다. 없으면 예외 — 임의의 루트로 넘어가지 않기 위해서다. */
export function findVaultRoot(startDir: string): string {
  let dir = fs.existsSync(startDir) ? fs.realpathSync(startDir) : path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, MARKER))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`볼트 루트를 찾지 못했다(${MARKER}가 없다): ${startDir}`);
}

/** 볼트 상대경로를 절대경로로 바꾼다. 절대경로나 볼트 밖이면 예외다. */
export function toVaultPath(root: string, p: string): string {
  if (path.isAbsolute(p) || p.startsWith('\\')) throw new Error(`절대경로는 쓸 수 없다: ${p}`);
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`볼트 밖을 가리킨다: ${p}`);
  return abs;
}

/** model의 checkProject에 넣을 readFile. 없는 파일과 디렉터리에는 null을 준다. */
export function makeReadFile(root: string): (vaultPath: string) => string | null {
  return (vaultPath) => {
    let abs: string;
    try {
      abs = toVaultPath(root, vaultPath);
    } catch {
      return null;
    }
    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile()) return null;
      return fs.readFileSync(abs, 'utf8');
    } catch {
      return null;
    }
  };
}

/** VIEWER_REPOS_DIR 아래 `<org>/<name>/` 체크아웃에서 코드 원본을 읽는다. */
export function makeReadRepoFile(reposDir: string): (repo: string, p: string) => string | null {
  const root = path.resolve(reposDir);
  return (repo, p) => {
    if (path.isAbsolute(p) || repo.includes('..') || p.split('/').includes('..')) return null;
    const abs = path.resolve(root, repo, p);
    if (path.relative(root, abs).startsWith('..')) return null;
    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile()) return null;
      return fs.readFileSync(abs, 'utf8');
    } catch {
      return null;
    }
  };
}
