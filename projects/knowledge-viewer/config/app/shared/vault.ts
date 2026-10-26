// 출처: projects/project-viewer/config/shell/loader/vault.ts (findVaultRoot, toVaultPath 복사)
// 볼트 루트 탐색과 경로 안전성. scope.ts도 파일 시스템을 만지지만 경로 검사는 이 파일이 맡는다.
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
  if (p === '' || p === '.') throw new Error('볼트 루트 자체는 문서가 아니다');
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error(`볼트 밖을 가리킨다: ${p}`);
  return abs;
}
