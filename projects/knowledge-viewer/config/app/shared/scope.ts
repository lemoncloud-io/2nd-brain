// 디스크 범위와 lint 범위. 제외 규칙은 vault_orphans.py(second-brain)의 것을 옮겼다.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import type { Entry } from './types.ts';
import { toVaultPath } from './vault.ts';

export const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  'node_modules', '.git', '.claude', '.obsidian', '.trash', '.locks',
  '__pycache__', '.venv', 'venv', 'dist', 'build', '.next', '.cache',
]);
/** 루트 바로 아래에서만 lint 범위 밖이다. */
export const EXCLUDED_TOP: readonly string[] = ['private', 'raw', 'archive'];

export type ScopeOptions = { includePrivate: boolean };

const EXCLUDED_LOWER: ReadonlySet<string> = new Set([...EXCLUDED_DIRS].map((d) => d.toLowerCase()));

/**
 * 조각 목록이 디스크 범위 밖인가. 빈 조각·`.`·`..`·NUL 이 든 조각은 막는다. 대소문자를 구분하지 않고 비교한다 —
 * 대소문자를 가리지 않는 파일 시스템에서 `Private`·`.GIT`로 우회하지 못하게 하려는 것이다.
 */
export function segmentsBlocked(segments: readonly string[], opts: ScopeOptions): boolean {
  if (segments.some((s) => s === '' || s === '.' || s === '..' || s.includes('\0'))) return true;
  if (segments.some((s) => EXCLUDED_LOWER.has(s.toLowerCase()))) return true;
  return segments[0]?.toLowerCase() === 'private' && !opts.includePrivate;
}

/**
 * 절대경로 abs(볼트 안)가 실제로(심링크·대소문자를 풀고 난 뒤) 허용 범위 안인가.
 * 정식 경로의 조각을 다시 검사하고, 첫 조각이 요청한 것과 다르면(다른 최상위 폴더로 가는 심링크) 거부한다.
 * 파일이 없으면 false다.
 */
export function isCanonicallyAllowed(root: string, abs: string, opts: ScopeOptions): boolean {
  let real: string;
  let realRoot: string;
  try {
    real = fs.realpathSync.native(abs);
    realRoot = fs.realpathSync.native(root);
  } catch {
    return false;
  }
  const rel = path.relative(realRoot, real);
  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return false;
  const canon = rel.split(path.sep);
  if (segmentsBlocked(canon, opts)) return false;
  const asked = path.relative(path.resolve(root), path.resolve(abs)).split(path.sep);
  return (asked[0] ?? '').toLowerCase() === (canon[0] ?? '').toLowerCase();
}

/** 이 디렉터리 항목이 걷는 폴더인가. 심링크 폴더는 아니다. */
function isWalkableDir(dirent: fs.Dirent): boolean {
  return !dirent.isSymbolicLink() && dirent.isDirectory();
}

/** 이 항목이 파일인가. 파일을 가리키는 심링크는 파일이다. */
function isFileEntry(abs: string, dirent: fs.Dirent): boolean {
  if (dirent.isFile()) return true;
  if (!dirent.isSymbolicLink()) return false;
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

function skipDir(rel: string, name: string, opts: ScopeOptions): boolean {
  if (EXCLUDED_DIRS.has(name)) return true;
  return rel === '' && name === 'private' && !opts.includePrivate;
}

/** 모든 파일(확장자 무관)을 볼트 상대 POSIX 경로로 돌려준다. 정렬된다. */
export function walkDisk(root: string, opts: ScopeOptions): string[] {
  const out: string[] = [];
  const visit = (rel: string): void => {
    const abs = rel === '' ? root : path.join(root, rel);
    for (const dirent of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel === '' ? dirent.name : `${rel}/${dirent.name}`;
      const childAbs = path.join(abs, dirent.name);
      if (isWalkableDir(dirent)) {
        if (!skipDir(rel, dirent.name, opts)) visit(childRel);
      } else if (isFileEntry(childAbs, dirent)) {
        if (!(rel === '' && EXCLUDED_DIRS.has(dirent.name))) out.push(childRel);
      }
    }
  };
  visit('');
  return out.sort();
}

/** git이 무시하는 경로의 집합이다. git 저장소가 아니면 빈 집합이다. */
export type GitIgnoreOptions = { strict?: boolean };

export function gitIgnored(root: string, paths: string[], opts: GitIgnoreOptions = {}): Set<string> {
  if (paths.length === 0) return new Set();
  const res = spawnSync('git', ['-C', root, 'check-ignore', '--stdin', '-z'], {
    input: paths.join('\0') + '\0',
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 60_000,
  });
  // 실패(저장소 아님·시간 초과 등)는 일부러 빈 집합이다 — 범위 계산이 git에 막히지 않게 한다.
  // 종료 코드 0은 무시된 경로가 있다, 1은 없다. 그 밖(저장소 아님 등)은 빈 집합이다.
  // strict(추적 캐시를 쓰는 CLI)는 그 실패를 예외로 올린다 — 로컬 파일이 캐시에 섞이면 안 되기 때문이다.
  if (res.error || (res.status !== 0 && res.status !== 1)) {
    if (opts.strict) throw new Error(`git check-ignore 를 실행하지 못했다(${root} 는 git 작업 트리가 아닌가): ${res.error?.message ?? res.stderr.trim()}`);
    return new Set();
  }
  if (res.status !== 0) return new Set();
  return new Set(res.stdout.split('\0').filter((p) => p !== ''));
}

/** lint 범위의 md: raw·archive(루트 아래)를 빼고 gitignore를 뺀다. private는 항상 뺀다. */
export function walkLint(root: string, opts: GitIgnoreOptions = {}): string[] {
  const md = walkDisk(root, { includePrivate: false }).filter((p) => {
    if (!p.endsWith('.md')) return false;
    const top = p.includes('/') ? p.slice(0, p.indexOf('/')) : '';
    return !EXCLUDED_TOP.includes(top);
  });
  const ignored = gitIgnored(root, md, opts);
  return md.filter((p) => !ignored.has(p));
}

export function kindOf(name: string): Entry['kind'] {
  const lower = name.toLowerCase();
  if (lower.endsWith('.md')) return 'md';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  return 'file';
}

/** dir을 정규화한다(끝 `/` 제거, ''·'.'는 루트). 제외·private·심링크 규칙을 어기면 예외다. */
function guardDir(root: string, rawDir: string, opts: ScopeOptions): string {
  const segments = rawDir.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.length === 0) return '';
  const dir = segments.join('/');
  if (segments.includes('..')) throw new Error(`.. 조각은 쓸 수 없다: ${dir}`);
  const abs = toVaultPath(root, dir);
  for (const seg of segments) {
    if (EXCLUDED_LOWER.has(seg.toLowerCase())) throw new Error(`제외된 폴더다: ${dir}`);
  }
  if (segments[0]?.toLowerCase() === 'private' && !opts.includePrivate) throw new Error(`private 폴더는 열 수 없다: ${dir}`);
  let cur = root;
  for (const seg of segments) {
    cur = path.join(cur, seg);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(cur);
    } catch {
      throw new Error(`폴더가 없다: ${dir}`);
    }
    if (stat.isSymbolicLink()) throw new Error(`심링크 폴더는 열 수 없다: ${dir}`);
  }
  if (!fs.statSync(abs).isDirectory()) throw new Error(`폴더가 아니다: ${dir}`);
  const realRoot = fs.realpathSync(root);
  const real = fs.realpathSync(abs);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error(`볼트 밖을 가리킨다: ${dir}`);
  // 정식 경로(대소문자를 푼 것)로 한 번 더 본다. 입력 `Private`가 실제 `private`일 수 있다.
  if (!isCanonicallyAllowed(root, abs, opts)) throw new Error(`열 수 없는 폴더다: ${dir}`);
  return dir;
}

/** 폴더 한 층을 나열한다. 폴더가 먼저, 그다음 이름순이다. dir이 ''면 볼트 루트다. */
export function listDir(root: string, rawDir: string, opts: ScopeOptions): Entry[] {
  const dir = guardDir(root, rawDir, opts);
  const abs = dir === '' ? root : toVaultPath(root, dir);
  const dirs: Entry[] = [];
  const files: Entry[] = [];
  for (const dirent of fs.readdirSync(abs, { withFileTypes: true })) {
    const childAbs = path.join(abs, dirent.name);
    const childRel = dir === '' ? dirent.name : `${dir}/${dirent.name}`;
    // 점으로 시작하는 항목은 목록에서 숨긴다(표시 규칙일 뿐, walkDisk·walkLint는 그대로다).
    if (dirent.name.startsWith('.')) continue;
    if (isWalkableDir(dirent)) {
      if (!skipDir(dir, dirent.name, opts)) {
        dirs.push({ name: dirent.name, path: childRel, kind: 'dir', ignored: false });
      }
    } else if (isFileEntry(childAbs, dirent)) {
      if (dir === '' && EXCLUDED_DIRS.has(dirent.name)) continue;
      files.push({ name: dirent.name, path: childRel, kind: kindOf(dirent.name), ignored: false });
    }
  }
  const ignored = gitIgnored(root, files.map((f) => f.path));
  for (const f of files) f.ignored = ignored.has(f.path);
  const byName = (a: Entry, b: Entry): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return [...dirs.sort(byName), ...files.sort(byName)];
}
