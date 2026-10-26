// 링크 그래프 캐시 CLI. build(전부 파싱)·verify(캐시 vs 디스크 대조)·update(바뀐 것만 파싱해 쓰기).
// 계약: docs/superpowers/specs/2026-10-23-knowledge-viewer-link-cache-design.md. lint 레인만 결과를 커밋한다.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { VaultIndex } from './server/index-store.ts';
import { CACHE_PATH, SCHEMA, brokenLinks, diffCache, isClean, isUsable, readCacheResult, writeCache } from './server/link-cache.ts';
import type { CacheDiff, LinkCache } from './server/link-cache.ts';
import { findVaultRoot } from './shared/vault.ts';

const USAGE = '사용법: node link-cache.ts <build|verify|update> [--vault DIR] [--cache docs/link-graph.yml] [--broken]';

type Args = { command: 'build' | 'verify' | 'update'; vault?: string; cache: string; broken: boolean };

function parseArgs(argv: string[]): Args {
  let command: Args['command'] | undefined;
  let vault: string | undefined;
  let cache = CACHE_PATH;
  let broken = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (a === 'build' || a === 'verify' || a === 'update') command = a;
    else if (a === '--vault') vault = argv[(i += 1)];
    else if (a === '--cache') cache = argv[(i += 1)] ?? cache;
    else if (a === '--broken') broken = true;
    else throw new Error(`알 수 없는 인자다: ${a}\n${USAGE}`);
  }
  if (!command) throw new Error(USAGE);
  return { command, vault, cache, broken };
}

function report(diff: CacheDiff, out: (line: string) => void): void {
  if (diff.parser) out('parser 지문이 다르다 — 추출 코드가 바뀌었다. 캐시 전체를 다시 만든다');
  for (const key of ['missing', 'gone', 'stale', 'drift'] as const) {
    const list = diff[key];
    if (list.length === 0) continue;
    out(`${key} ${list.length}`);
    for (const p of list) out(`  ${p}`);
  }
}

/** paths 중 git 이 추적하지 않는 것(무시되지 않은 것만 — 무시된 것은 범위 밖이다). git 실패는 빈 목록이다. */
function untrackedIn(root: string, paths: string[]): string[] {
  const res = spawnSync('git', ['-C', root, 'ls-files', '--others', '--exclude-standard', '-z', '--', ...paths], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 60_000,
  });
  if (res.error || res.status !== 0) return [];
  return res.stdout.split('\0').filter((p) => p !== '').sort();
}

/** 종료 코드를 돌려준다: 0 같음·성공, 1 다름, 2 캐시 없음·스키마 불일치·git 아님·인자 오류. */
export function runLinkCache(argv: string[], out: (line: string) => void = console.log, err: (line: string) => void = console.error): number {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    err((e as Error).message);
    return 2;
  }
  const root = findVaultRoot(args.vault ?? process.cwd());
  const read = readCacheResult(root, args.cache);
  const old = read.cache;
  const usable = isUsable(old);
  let fresh: LinkCache;
  let stats: { files: number; cached: number; parsed: number; ms: number };
  try {
    const idx = new VaultIndex(root);
    stats = idx.build({ cache: args.command === 'build' ? undefined : usable ? old : undefined, strict: true });
    fresh = idx.snapshot();
  } catch (e) {
    err(`쓰지 않는다 — ${(e as Error).message}`);
    return 2;
  }
  const summary = `문서 ${stats.files} (캐시 ${stats.cached} · 파싱 ${stats.parsed}) ${(stats.ms / 1000).toFixed(1)}s · 링크 ${fresh.links}(엣지 ${fresh.pairs}) · 깨진 링크 ${brokenLinks(fresh).length}`;
  if (args.broken) for (const b of brokenLinks(fresh)) out(`${b.path}:${b.line} ‹${b.target}›`);

  if (args.command === 'verify') {
    if (read.status === 'unreadable') {
      out(`${args.cache} 를 읽지 못했다 — YAML 이 깨졌거나 모양이 다르다(충돌 표식?). build 로 다시 만든다`);
      return 2;
    }
    if (old === null) {
      out(`${args.cache} 가 없다`);
      return 2;
    }
    if (old.schema !== SCHEMA) {
      out(`${args.cache} 의 schema ${old.schema} 는 이 코드(${SCHEMA})와 다르다`);
      return 2;
    }
    const diff = diffCache(old, fresh);
    report(diff, out);
    out(summary);
    return isClean(diff) ? 0 : 1;
  }
  // 추적 캐시에 들어가는 미추적 md 를 알린다 — 커밋 전에 사람이 본다(gitignore 된 것은 처음부터 범위 밖이다).
  const untracked = untrackedIn(root, fresh.docs.map((d) => d.path));
  if (untracked.length > 0) {
    out(`미추적 md ${untracked.length} — 커밋 전에 확인한다(로컬 초안이면 커밋하지 않거나 범위 밖으로 옮긴다)`);
    for (const p of untracked) out(`  ${p}`);
  }
  const written = writeCache(root, fresh, args.cache);
  out(summary);
  out(written ? `${args.cache} 를 썼다` : `${args.cache} 변경 없음`);
  return 0;
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

if (isMain()) process.exit(runLinkCache(process.argv.slice(2)));
