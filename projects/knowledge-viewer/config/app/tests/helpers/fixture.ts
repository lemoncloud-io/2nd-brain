// 시험용 볼트 복사본. fixture를 임시 디렉터리에 복사하고 git 저장소로 만든다.
// .gitignore와 private/p.md는 볼트 규칙(private/ 무시) 때문에 fixture에 두지 못하고 여기서 쓴다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const FIXTURE = path.join(import.meta.dirname, '..', 'fixtures', 'vault');

function git(root: string, args: string[]): void {
  const res = spawnSync(
    'git',
    ['-C', root, '-c', 'user.email=test@example.com', '-c', 'user.name=test', '-c', 'commit.gpgsign=false', ...args],
    {
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    },
  );
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} 실패: ${res.stderr}`);
}

export function makeFixtureVault(): { root: string; cleanup(): void } {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kv-fixture-'));
  const root = path.join(tmp, 'vault');
  fs.cpSync(FIXTURE, root, { recursive: true });
  fs.writeFileSync(path.join(root, '.gitignore'), 'outputs/local.md\n');
  fs.mkdirSync(path.join(root, 'private'), { recursive: true });
  fs.writeFileSync(path.join(root, 'private', 'p.md'), '---\ntype: concept\n---\n\n# 비공개\n\n비공개 문서다.\n');
  const cleanup = (): void => fs.rmSync(tmp, { recursive: true, force: true });
  try {
    git(root, ['init', '-q']);
    git(root, ['add', '-A']);
  } catch (e) {
    cleanup();
    throw e;
  }
  return { root, cleanup };
}
