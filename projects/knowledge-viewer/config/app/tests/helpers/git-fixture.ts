// 시험용 git 볼트. makeFixtureVault() 작업 트리를 master 에 커밋하고, 같은 임시 폴더의 bare 저장소를
// origin 으로 둔다. openPr 은 PR 브랜치를 origin 의 refs/heads/<branch> 와 refs/pull/<n>/head 로 올린다.
// 디스크 작업 트리는 늘 커밋과 다르게 바꿔 둔다(wiki/alpha.md 에 "디스크" 줄) — 소스가 섞이면 드러나게.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import type { GhRunner } from '../../server/panels/prs.ts';
import { makeFixtureVault } from './fixture.ts';

export const DISK_LINE = '디스크에서만 고친 줄';

function run(root: string, args: string[]): string {
  const res = spawnSync(
    'git',
    ['-C', root, '-c', 'user.email=test@example.com', '-c', 'user.name=test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    {
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    },
  );
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} 실패: ${res.stderr}`);
  return res.stdout.trim();
}

export type GitFixture = {
  root: string;
  originDir: string;
  cleanup(): void;
  commitOnMaster(files: Record<string, string>, msg: string): string;
  openPr(n: number, base: string, files: Record<string, string>, msg: string): { headOid: string };
  /** openPr 로 연 PR 에 `gh pr view <n> --json …` 처럼 답하는 스텁. 모르는 번호는 status 1. */
  gh: GhRunner;
};

export function makeGitFixture(): GitFixture {
  const { root, cleanup } = makeFixtureVault();
  const originDir = path.join(path.dirname(root), 'origin.git');
  const prs = new Map<number, Record<string, unknown>>();

  const write = (files: Record<string, string>): void => {
    for (const [rel, text] of Object.entries(files)) {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text);
    }
  };
  /** 디스크의 wiki/alpha.md 를 master 커밋과 다르게 둔다. 여러 번 불러도 결과는 같다. */
  const touchDisk = (): void => {
    const committed = run(root, ['show', 'master:wiki/alpha.md']);
    fs.writeFileSync(path.join(root, 'wiki', 'alpha.md'), `${committed}\n\n${DISK_LINE}\n`);
  };

  try {
    // 실제 볼트처럼 private/ 는 커밋하지 않는다.
    fs.appendFileSync(path.join(root, '.gitignore'), 'private/\n');
    run(root, ['rm', '-r', '-q', '--cached', 'private']);
    run(root, ['symbolic-ref', 'HEAD', 'refs/heads/master']);
    run(root, ['add', '-A']);
    run(root, ['commit', '-q', '-m', 'init']);
    run(path.dirname(root), ['init', '-q', '--bare', originDir]);
    run(root, ['remote', 'add', 'origin', originDir]);
    run(root, ['push', '-q', 'origin', 'master']);
    touchDisk();
  } catch (e) {
    cleanup();
    throw e;
  }

  const commitOnMaster = (files: Record<string, string>, msg: string): string => {
    // 추적 파일의 디스크 수정은 버리고(추적 안 된 것 — 시험이 만든 심링크 등 — 은 남는다) 커밋한다.
    run(root, ['checkout', '-q', '-f', 'master']);
    write(files);
    run(root, ['add', '-A']);
    run(root, ['commit', '-q', '-m', msg]);
    run(root, ['push', '-q', 'origin', 'master']);
    const oid = run(root, ['rev-parse', 'HEAD']);
    touchDisk();
    return oid;
  };

  const openPr = (n: number, base: string, files: Record<string, string>, msg: string): { headOid: string } => {
    const branch = `pr-${n}`;
    run(root, ['checkout', '-q', '-f', '-B', branch, base]);
    write(files);
    run(root, ['add', '--', ...Object.keys(files)]);
    run(root, ['commit', '-q', '-m', msg]);
    run(root, ['push', '-q', '-f', 'origin', `${branch}:refs/heads/${branch}`, `${branch}:refs/pull/${n}/head`]);
    const headOid = run(root, ['rev-parse', 'HEAD']);
    run(root, ['checkout', '-q', '-f', 'master']);
    touchDisk();
    prs.set(n, {
      number: n,
      title: `PR ${n}`,
      author: { login: 't' },
      headRefName: branch,
      baseRefName: base,
      headRefOid: headOid,
      updatedAt: '2026-10-23T00:00:00Z',
      url: `https://example.test/pull/${n}`,
    });
    return { headOid };
  };

  const gh: GhRunner = async (args) => {
    if (args[0] !== 'pr' || args[1] !== 'view') return { stdout: '', stderr: `unknown: ${args.join(' ')}`, status: 1 };
    const meta = prs.get(Number(args[2]));
    if (meta === undefined) return { stdout: '', stderr: 'not found', status: 1 };
    return { stdout: JSON.stringify(meta), stderr: '', status: 0 };
  };

  return { root, originDir, cleanup, commitOnMaster, openPr, gh };
}
