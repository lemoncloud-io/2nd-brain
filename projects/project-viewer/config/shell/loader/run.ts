// cli의 build·dev가 실제로 하는 일. Vite는 JS API로만 부른다.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import type { Bundle } from '../model/index.ts';
import { collect, readProjectGit, watchTargets } from './collect.ts';

const SHELL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = path.join(SHELL_DIR, 'vite.config.ts');

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** 스탬프 한 줄 요약. 볼트 밖 절대경로를 남기지 않는다. */
export function summarize(bundle: Bundle): string[] {
  const { stamp } = bundle;
  const commit = stamp.commit === null ? '커밋 모름' : `${stamp.commit}${stamp.dirty ? ' (dirty)' : ''}`;
  const c = stamp.counts;
  return [
    `스탬프: ${stamp.builtAt} · ${commit} · 문서 ${stamp.docCount}개 · yml ${stamp.ymlDigest}`,
    `경고: 범위 밖 링크 ${c.unresolvedLinks} · 참고 원본 누락 ${c.missingReferences} · ` +
      `미확인 코드 ${c.unverifiedCode} · 물려받은 근거 ${c.inheritedEvidence}`,
  ];
}

export async function buildViewer(projectDir: string): Promise<void> {
  const { root } = watchTargets(projectDir);
  const bundle = collect({
    projectDir,
    git: readProjectGit(projectDir),
    now: () => new Date(),
  });

  process.env['VIEWER_PROJECT'] = projectDir;
  const { build } = await import('vite');
  await build({ configFile: CONFIG_FILE, root: SHELL_DIR, logLevel: 'warn' });

  const out = path.join(projectDir, 'outputs', 'viewer', 'index.html');
  const size = fs.existsSync(out) ? fs.statSync(out).size : 0;
  console.log(`산출물: ${path.relative(root, out)} (${human(size)})`);
  for (const line of summarize(bundle)) console.log(line);
}

export async function devViewer(projectDir: string): Promise<void> {
  process.env['VIEWER_PROJECT'] = projectDir;
  const { createServer } = await import('vite');
  // 127.0.0.1에만 바인딩한다 — 뷰어는 바깥에 내보내는 물건이 아니다.
  const server = await createServer({
    configFile: CONFIG_FILE,
    root: SHELL_DIR,
    server: { host: '127.0.0.1', strictPort: false },
  });
  await server.listen();
  server.printUrls();
}
