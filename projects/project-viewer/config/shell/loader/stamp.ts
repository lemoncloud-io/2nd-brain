// 빌드 시각·커밋·dirty·지문. 스탬프는 전부 자동이다 — 손으로 쓰는 날짜를 두지 않기 위해서다.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import type { Stamp } from '../model/index.ts';

export interface GitInfo {
  commit: string | null;
  dirty: boolean;
}

/** git 호출 하나. 실패하면 던진다. 테스트는 이 자리를 가짜로 바꿔 실제 git을 부르지 않는다. */
export type RunGit = (args: string[]) => string;

export interface ReadGitOptions {
  /** dirty 판정에 볼 볼트 상대경로들. 비우면 저장소 전체를 본다. */
  paths?: string[];
  run?: RunGit;
}

/** sha256 앞 12자. 파일 전체(frontmatter 포함) 기준이다. */
export function digest12(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
}

function defaultRun(root: string): RunGit {
  return (args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/**
 * 커밋과 dirty를 읽는다. git이 없거나 저장소가 아니면 `{commit: null, dirty: false}`다 —
 * 빌드를 막지 않되 스탬프에서 "모른다"가 "깨끗하다"로 보이지 않게 한다.
 */
export function readGit(root: string, options: ReadGitOptions = {}): GitInfo {
  const run = options.run ?? defaultRun(root);
  let commit: string | null = null;
  try {
    const out = run(['rev-parse', '--short=8', 'HEAD']).trim();
    commit = out === '' ? null : out;
  } catch {
    return { commit: null, dirty: false };
  }

  let dirty = false;
  try {
    const paths = options.paths ?? [];
    const args = paths.length > 0 ? ['status', '--porcelain', '--', ...paths] : ['status', '--porcelain'];
    dirty = run(args).trim() !== '';
  } catch {
    return { commit: null, dirty: false };
  }
  return { commit, dirty };
}

export interface StampInput {
  now: () => Date;
  git: GitInfo;
  docCount: number;
  ymlDigest: string;
  ledgerDigest: string | null;
  counts: Stamp['counts'];
}

/** 순수 함수. 키 순서까지 고정해 같은 입력이면 같은 바이트가 나오게 한다. */
export function makeStamp(input: StampInput): Stamp {
  return {
    builtAt: input.now().toISOString(),
    commit: input.git.commit,
    dirty: input.git.dirty,
    docCount: input.docCount,
    ymlDigest: input.ymlDigest,
    ledgerDigest: input.ledgerDigest,
    counts: {
      unresolvedLinks: input.counts.unresolvedLinks,
      missingReferences: input.counts.missingReferences,
      unverifiedCode: input.counts.unverifiedCode,
      inheritedEvidence: input.counts.inheritedEvidence,
    },
  };
}
