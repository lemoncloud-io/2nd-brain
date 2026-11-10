// node cli.ts <명령> <프로젝트 디렉터리>
// 명령 분기는 표 하나로 둔다 — build·dev는 다음 작업 패키지가 여기에 끼워 넣는다.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import type { CheckResult, FidelityResult, Issue } from './model/index.ts';
import { checkFidelity, checkProject, parseViewer } from './model/index.ts';
import { findVaultRoot, makeReadFile, makeReadRepoFile } from './loader/vault.ts';
import { buildViewer, devViewer } from './loader/run.ts';

const FIDELITY_FLAG = '--fidelity';

const USAGE = [
  '쓰임: node cli.ts <check|build|dev> <프로젝트 디렉터리>',
  '',
  '  check   <디렉터리>/config/viewer.yml을 검사한다. 오류가 있으면 종료 코드 1.',
  '  build   단일 HTML을 만든다.',
  '  dev     개발 서버를 띄운다.',
  '  --fidelity  check에 붙이면 해설 문장이 원본에 있는지 함께 본다. 미일치가 있으면 종료 코드 1.',
  '',
  '환경 변수 VIEWER_REPOS_DIR가 있으면 그 아래 <org>/<name>/에서 저장소 코드 원본을 읽는다.',
].join('\n');

function formatIssue(issue: Issue): string {
  return `[${issue.code}] ${issue.where || '(문서 전체)'} — ${issue.message}`;
}

/** 원본 본문을 읽어 충실도 검사를 돌린다. viewer를 얻지 못하면(파싱 실패) null. */
function runFidelity(
  viewerText: string,
  result: CheckResult,
  readFile: (vaultPath: string) => string | null,
): FidelityResult | null {
  let viewer = result.viewer;
  if (!viewer) {
    try {
      viewer = parseViewer(viewerText);
    } catch {
      return null; // 스키마 오류는 위에서 이미 보고했다
    }
  }
  const docs = new Map<string, string>();
  for (const spec of viewer.sources) {
    if (spec.kind === 'data' || spec.repo !== undefined) continue; // 본문이 없거나 원문이 아니다
    const text = readFile(spec.path);
    if (text !== null) docs.set(spec.id, text);
  }
  return checkFidelity({ viewer, docs });
}

function runCheck(projectDir: string, fidelity = false): number {
  let root: string;
  try {
    root = findVaultRoot(projectDir);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  const viewerPath = path.join(projectDir, 'config', 'viewer.yml');
  if (!fs.existsSync(viewerPath)) {
    console.error(`viewer.yml이 없다: ${path.relative(root, viewerPath)}`);
    return 2;
  }

  const reposDir = process.env['VIEWER_REPOS_DIR'];
  const viewerText = fs.readFileSync(viewerPath, 'utf8');
  const readFile = makeReadFile(root);
  const result = checkProject({
    viewerText,
    readFile,
    readRepoFile: reposDir ? makeReadRepoFile(reposDir) : undefined,
  });

  const errors = result.issues.filter((i) => i.level === 'error');
  const warnings = result.issues.filter((i) => i.level === 'warning');
  const fid = fidelity ? runFidelity(viewerText, result, readFile) : null;

  for (const issue of [...errors, ...warnings]) console.log(formatIssue(issue));
  if (fid) {
    const level = (want: Issue['level']): Issue[] => fid.issues.filter((i) => i.level === want);
    for (const issue of [...level('error'), ...level('warning')]) console.log(formatIssue(issue));
  }
  console.log(`${path.relative(root, viewerPath)} — 오류 ${errors.length}건, 경고 ${warnings.length}건`);
  if (fid) {
    console.log(
      `충실도 — 해설 ${fid.strings}개 · 문장 ${fid.sentences}개 · 완전 일치 ${fid.exact}` +
        ` · 다듬음 ${fid.trimmed} · 다른 원본 ${fid.elsewhere} · 미일치 ${fid.missing} · 건너뜀 ${fid.skipped}`,
    );
  }
  return errors.length > 0 || (fid?.missing ?? 0) > 0 ? 1 : 0;
}

// build·dev는 Vite를 기다려야 해서 비동기다. 표의 모양을 지키려고 종료 코드는 나중에 적는다.
function later(work: Promise<void>): number {
  work.catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
  return 0;
}

function runBuild(projectDir: string): number {
  const code = runCheck(projectDir);
  if (code !== 0) return code;
  return later(buildViewer(projectDir));
}

function runDev(projectDir: string): number {
  const code = runCheck(projectDir);
  if (code !== 0) return code;
  return later(devViewer(projectDir));
}

// build·dev는 --fidelity를 무시한다.
const COMMANDS: Record<string, (projectDir: string, fidelity: boolean) => number> = {
  check: runCheck,
  build: runBuild,
  dev: runDev,
};

function main(argv: string[]): number {
  const fidelity = argv.includes(FIDELITY_FLAG);
  const [name, dir] = argv.filter((arg) => arg !== FIDELITY_FLAG);
  if (!name || !Object.prototype.hasOwnProperty.call(COMMANDS, name)) {
    console.error(USAGE);
    return 2;
  }
  if (!dir) {
    console.error(`${name}에는 프로젝트 디렉터리가 필요하다.\n\n${USAGE}`);
    return 2;
  }
  const projectDir = path.resolve(dir);
  if (!fs.existsSync(projectDir)) {
    console.error(`그런 디렉터리가 없다: ${dir}`);
    return 2;
  }
  return COMMANDS[name]!(projectDir, fidelity);
}

process.exitCode = main(process.argv.slice(2));
