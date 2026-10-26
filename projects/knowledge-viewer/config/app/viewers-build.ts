// 뷰어 모음 등록부 CLI. 볼트의 스킬 등록 레이어를 훑어 projects/knowledge-viewer/viewers.yml 을 만든다.
//   node viewers-build.ts            → 쓴다(내용이 같으면 쓰지 않는다)
//   node viewers-build.ts --check    → 쓰지 않고 다르면 종료 코드 1
//   --root <볼트 루트>               → 기본은 현재 폴더에서 위로 찾은 볼트
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectViewers, renderRegistry, REGISTRY_PATH } from './server/panels/viewers-build.ts';
import { findVaultRoot } from './shared/vault.ts';

export function runViewersBuild(argv: string[], out: (line: string) => void = console.log, err: (line: string) => void = console.error): number {
  let check = false;
  let rootArg: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') check = true;
    else if (a === '--root') rootArg = argv[++i] ?? null;
    else {
      err(`viewers-build: 모르는 인자 ${a}`);
      return 2;
    }
  }
  let root: string;
  try {
    root = findVaultRoot(rootArg ?? process.cwd());
  } catch (e) {
    err(`viewers-build: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const r = collectViewers(root);
  const next = renderRegistry(r.entries);
  const file = path.join(root, REGISTRY_PATH);
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  for (const p of r.problems) err(`  뺌 ${p.skill}: ${p.reason}`);
  const summary = `뷰어 ${r.entries.length}건 (등록 스킬 ${r.scanned} · 뷰어 아님 ${r.skipped} · 뺌 ${r.problems.length})`;
  if (check) {
    if (prev === next) {
      out(`viewers-build --check: 최신 — ${summary}`);
      return 0;
    }
    err(`viewers-build --check: ${prev === null ? '등록부가 없다' : '등록부가 스킬과 다르다'} — ${REGISTRY_PATH}. npm run viewers-build 로 다시 만든다.`);
    return 1;
  }
  if (prev === next) {
    out(`viewers-build: 바뀐 것 없음 — ${summary}`);
    return 0;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  out(`viewers-build: ${REGISTRY_PATH} 를 썼다 — ${summary}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = runViewersBuild(process.argv.slice(2));
}
