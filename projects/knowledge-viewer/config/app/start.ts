// 설치·빌드·실행 묶음. node_modules가 없으면 설치하고, dist가 낡았으면 빌드한 뒤 서버를 같은 프로세스에서 띄운다.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadBuildExtension } from './ext-build.ts';
import { extDir } from './ext-locate.ts';

const appDir = path.dirname(fileURLToPath(import.meta.url));
// project-viewer 셸: viewer.yml 통합 보기가 화면(src·loader)을 묶음에 넣고, 서버(/api/project-viewer)가 그 loader 를 부른다.
const shellDir = path.resolve(appDir, '..', '..', '..', 'project-viewer', 'config', 'shell');

/** 설치가 필요한 앱 폴더: lockfile 이 있고(npm ci 의 기준) 설치가 없거나 낡은 것. 순서는 목록 그대로. */
export function appsNeedingInstall(dirs: string[]): string[] {
  return dirs.filter((d) => fs.existsSync(path.join(d, 'package-lock.json')) && needsInstall(d));
}

/** 빌드 신선도에 더할 앱 소스: 화면(src)과 의존성 선언. 서버 코드는 묶음에 들지 않으므로 보지 않는다. */
export function appBuildSources(dirs: string[]): string[] {
  return dirs.flatMap((d) => ['src', 'package.json', 'package-lock.json'].map((p) => path.join(d, p)));
}

function newestMtimeMs(target: string): number {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    newest = Math.max(newest, newestMtimeMs(path.join(target, entry.name)));
  }
  return newest;
}

// dist/index.html이 없거나, srcDirs(디렉터리는 재귀, 파일은 그 자체) 안 가장 새 mtime보다 오래되면 true.
export function isStale(distDir: string, srcDirs: string[]): boolean {
  let built: number;
  try {
    built = fs.statSync(path.join(distDir, 'index.html')).mtimeMs;
  } catch {
    return true;
  }
  return srcDirs.some((s) => newestMtimeMs(s) > built);
}

// node_modules가 없거나, package-lock.json이 마지막 설치 때 npm이 남긴 node_modules/.package-lock.json보다
// 새것이면 true. 당겨 받은 커밋이 의존성을 바꾸면 lock의 mtime이 올라가 다시 설치한다. lock이 없는 폴더는
// 처음 설치만 본다.
export function needsInstall(dir: string): boolean {
  const nodeModules = path.join(dir, 'node_modules');
  if (!fs.existsSync(nodeModules)) return true;
  let lock: number;
  try {
    lock = fs.statSync(path.join(dir, 'package-lock.json')).mtimeMs;
  } catch {
    return false;
  }
  try {
    return lock > fs.statSync(path.join(nodeModules, '.package-lock.json')).mtimeMs;
  } catch {
    return true;
  }
}

// Windows의 npm은 npm.cmd라 셸 없이는 실행되지 않는다. 셸에 인자 배열을 넘기는 것은 Node 24에서
// 폐기 경고(DEP0190)가 나므로 명령 한 줄로 합친다. 인자는 이 파일의 고정 문자열뿐이다.
export function npmCommand(args: string[], platform: NodeJS.Platform): { file: string; args: string[]; shell: boolean } {
  if (platform === 'win32') return { file: ['npm', ...args].join(' '), args: [], shell: true };
  return { file: 'npm', args, shell: false };
}

function npm(args: string[], cwd = appDir): void {
  const cmd = npmCommand(args, process.platform);
  const r = spawnSync(cmd.file, cmd.args, { cwd, stdio: 'inherit', shell: cmd.shell });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
}

export async function main(argv: string[]): Promise<void> {
  if (needsInstall(appDir)) {
    npm([fs.existsSync(path.join(appDir, 'package-lock.json')) ? 'ci' : 'install']);
  }
  // 셸 의존성: 서버의 /api/project-viewer 가 셸 loader 를 부른다(없으면 그 경로만 503). 앱과 같은 규칙으로 깐다.
  if (fs.existsSync(path.join(shellDir, 'package-lock.json')) && needsInstall(shellDir)) {
    npm(['ci'], shellDir);
  }
  // 앱 폴더도 같은 규칙(lockfile 기준 npm ci). 빠지면 그 앱만 지연 import 가 503 이다.
  // 앱 폴더·감시 경로는 확장 층(ext/build.ts)이 준다. 확장이 없으면 빈 값, 깨졌으면 여기서 멈춘다.
  const ext = await loadBuildExtension();
  const appDirs = ext.installDirs;
  for (const d of appsNeedingInstall(appDirs)) npm(['ci'], d);
  const dir = extDir();
  const srcs = [
    ...['src', 'shared', 'index.html', 'vite.config.ts', 'app-embed-plugin.ts', 'ext-locate.ts', 'ext-build.ts', 'package.json', 'package-lock.json'].map((p) => path.join(appDir, p)),
    // 확장 폴더 자체(ui·build 가 묶음에 든다)와 확장이 더한 감시 경로.
    ...(dir === null ? [] : [dir]),
    ...ext.watch,
    // 통합 보기 묶음에 들어가는 셸 화면과 플러그인.
    ...['src', 'loader', 'model', 'package.json'].map((p) => path.join(shellDir, p)),
    // 앱 플러그인 화면도 묶음에 든다.
    ...appBuildSources(appDirs),
  ];
  if (isStale(path.join(appDir, 'dist'), srcs)) npm(['run', 'build']);
  const { runCli } = await import('./server/main.ts');
  await runCli(argv);
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
