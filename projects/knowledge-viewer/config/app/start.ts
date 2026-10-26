// 설치·빌드·실행 묶음. node_modules가 없으면 설치하고, dist가 낡았으면 빌드한 뒤 서버를 같은 프로세스에서 띄운다.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appDir = path.dirname(fileURLToPath(import.meta.url));

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

// Windows의 npm은 npm.cmd라 셸 없이는 실행되지 않는다. 셸에 인자 배열을 넘기는 것은 Node 24에서
// 폐기 경고(DEP0190)가 나므로 명령 한 줄로 합친다. 인자는 이 파일의 고정 문자열뿐이다.
export function npmCommand(args: string[], platform: NodeJS.Platform): { file: string; args: string[]; shell: boolean } {
  if (platform === 'win32') return { file: ['npm', ...args].join(' '), args: [], shell: true };
  return { file: 'npm', args, shell: false };
}

function npm(args: string[]): void {
  const cmd = npmCommand(args, process.platform);
  const r = spawnSync(cmd.file, cmd.args, { cwd: appDir, stdio: 'inherit', shell: cmd.shell });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
}

export async function main(argv: string[]): Promise<void> {
  if (!fs.existsSync(path.join(appDir, 'node_modules'))) {
    npm([fs.existsSync(path.join(appDir, 'package-lock.json')) ? 'ci' : 'install']);
  }
  const srcs = ['src', 'shared', 'index.html', 'vite.config.ts'].map((p) => path.join(appDir, p));
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
