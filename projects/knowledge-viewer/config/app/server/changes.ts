// PR 이 바꾼 것: 변경 파일 목록과 문서별 hunk(줄 범위).
// 디프 기준은 `git merge-base refs/kv/base/<base> refs/kv/pr/<n>` 이다 — 스택 PR 은 제 커밋만 보인다.
// 줄 번호는 파일 전체 기준(frontmatter 포함)이다. 정본 형은 여기, 화면 쪽 거울은 src/app/types.ts 다.
import { git } from './git.ts';
import { FETCH_TTL_MS, baseRef, prRef, redactReason, type PrMeta, type SourceManager } from './source.ts';

export type ChangedFile = { path: string; status: 'A' | 'M' | 'D' | 'R'; from?: string };

export type PrChanges = PrMeta & {
  /** base 브랜치 ref(refs/kv/base/<base>)의 커밋 oid. */
  baseOid: string;
  mergeBase: string;
  /** 디프를 뜬 PR 머리 커밋 oid(fetch 한 refs/kv/pr/<n>). gh 의 headOid 와 다를 수 있다(fetch 실패로 옛 ref). */
  headCommit: string;
  files: ChangedFile[];
};

export type DocChange = {
  status: ChangedFile['status'] | null;
  /** 새 파일에서 바뀌거나 더한 줄 범위(양끝 포함). */
  hunks: { start: number; end: number }[];
  /** 지운 줄. afterLine 은 새 파일에서 지운 자리 바로 앞 줄(0 이면 맨 앞). */
  removed: { afterLine: number; count: number }[];
  added: number;
  deleted: number;
};

type GitFn = typeof git;
export type ChangesDeps = { git?: GitFn; now?: () => number };

const NO_CHANGE = (): DocChange => ({ status: null, hunks: [], removed: [], added: 0, deleted: 0 });

/** `git diff --name-status -z` 출력. `R<점수>`·`C<점수>` 는 경로 둘(옛·새)을 먹는다. A·M·D·R 밖은 M 으로 본다. */
export function parseNameStatus(stdout: string): ChangedFile[] {
  const parts = stdout.split('\0');
  const out: ChangedFile[] = [];
  let i = 0;
  while (i < parts.length) {
    const code = parts[i++] ?? '';
    if (code === '') continue;
    const letter = code[0]!;
    if (letter === 'R' || letter === 'C') {
      const from = parts[i++];
      const to = parts[i++];
      if (from === undefined || to === undefined || to === '') break;
      out.push(letter === 'R' ? { path: to, status: 'R', from } : { path: to, status: 'M' });
      continue;
    }
    const p = parts[i++];
    if (p === undefined || p === '') break;
    out.push({ path: p, status: letter === 'A' || letter === 'D' || letter === 'M' ? letter : 'M' });
  }
  return out;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** `git diff -U0` 출력의 hunk 머리만 읽는다. 머리 뒤 문맥 글·본문 줄·`\ No newline` 줄은 건너뛴다. */
export function parseHunks(stdout: string): Pick<DocChange, 'hunks' | 'removed' | 'added' | 'deleted'> {
  const r: Pick<DocChange, 'hunks' | 'removed' | 'added' | 'deleted'> = { hunks: [], removed: [], added: 0, deleted: 0 };
  for (const line of stdout.split('\n')) {
    const m = HUNK.exec(line);
    if (m === null) continue;
    const b = m[2] === undefined ? 1 : Number(m[2]);
    const c = Number(m[3]);
    const d = m[4] === undefined ? 1 : Number(m[4]);
    if (d > 0) r.hunks.push({ start: c, end: c + d - 1 });
    else if (b > 0) r.removed.push({ afterLine: c, count: b });
    r.added += d;
    r.deleted += b;
  }
  return r;
}

type CacheEntry = { at: number; key: string; value: PrChanges };
const CACHE_MAX = 64;
/** 관리자별 캐시. PR 번호 → 마지막 결과. 관리자(서버)가 사라지면 함께 사라진다. */
const CACHES = new WeakMap<SourceManager, Map<number, CacheEntry>>();

function cacheOf(mgr: SourceManager): Map<number, CacheEntry> {
  let m = CACHES.get(mgr);
  if (m === undefined) {
    m = new Map();
    CACHES.set(mgr, m);
  }
  return m;
}

function revParse(root: string, ref: string, run: GitFn): string | null {
  const r = run(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  const oid = r.stdout.trim();
  return r.ok && oid !== '' ? oid : null;
}

/**
 * PR 이 바꾼 파일 목록. 리더를 열어(fetch, 60초 ttl) refs/kv/pr/<n>·refs/kv/base/<base> 를 받은 뒤
 * merge-base 와 `diff --name-status` 를 돌린다. 머리(gh 의 headOid 와 받은 커밋)가 같고 60초 안이면 다시 돌리지 않는다.
 */
export async function prChanges(mgr: SourceManager, root: string, n: number, deps: ChangesDeps = {}): Promise<PrChanges | { error: string }> {
  const run = deps.git ?? git;
  const now = deps.now ?? Date.now;
  const meta = await mgr.prMeta(n);
  if ('error' in meta) return { error: meta.error };
  const reader = await mgr.reader({ kind: 'pr', number: n }, false);
  if ('error' in reader) return { error: reader.error };
  const headRef = prRef(n);
  const bRef = baseRef(meta.base);
  const headCommit = revParse(root, headRef, run);
  if (headCommit === null) return { error: `ref 가 없다: ${headRef}` };
  const baseOid = revParse(root, bRef, run);
  if (baseOid === null) return { error: `ref 가 없다: ${bRef}` };

  const cache = cacheOf(mgr);
  const key = `${meta.headOid}\0${headCommit}\0${baseOid}`;
  const hit = cache.get(n);
  if (hit !== undefined && hit.key === key && now() - hit.at <= FETCH_TTL_MS) return { ...hit.value, ...meta, files: hit.value.files.slice() };

  const mb = run(root, ['merge-base', baseOid, headCommit]);
  const mergeBase = mb.stdout.trim();
  // stderr 는 사람에게 보인다 — 절대경로·file:// 를 가린다(redactReason 은 첫 줄만 남긴다).
  if (!mb.ok || mergeBase === '') return { error: `merge-base 실패: ${redactReason(mb.stderr) || '공통 조상이 없다'}` };
  const diff = run(root, ['diff', '--no-ext-diff', '--no-color', '--name-status', '-z', '-M', `${mergeBase}..${headCommit}`]);
  if (!diff.ok) return { error: `diff 실패: ${redactReason(diff.stderr) || 'git 오류'}` };
  const value: PrChanges = { ...meta, baseOid, mergeBase, headCommit, files: parseNameStatus(diff.stdout) };
  if (!cache.has(n) && cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(n, { at: now(), key, value });
  return { ...value, files: value.files.slice() };
}

/** 문서 하나의 hunk. 목록에 없으면 status null. 지운 문서는 D·빈 hunk. 이름을 바꾼 문서는 옛 경로와 짝지어 뜬다. */
export function docChange(root: string, changes: PrChanges, rel: string, deps: Pick<ChangesDeps, 'git'> = {}): DocChange {
  const file = changes.files.find((f) => f.path === rel);
  if (file === undefined) return NO_CHANGE();
  if (file.status === 'D') return { ...NO_CHANGE(), status: 'D' };
  const run = deps.git ?? git;
  const paths = file.status === 'R' && file.from !== undefined ? [file.from, rel] : [rel];
  const r = run(root, [
    '--literal-pathspecs',
    'diff',
    '--no-ext-diff',
    '--no-color',
    '-U0',
    // 사용자 diff.interHunkContext 설정이 붙은 hunk 를 합치지 못하게 한다.
    '--inter-hunk-context=0',
    ...(file.status === 'R' ? ['-M'] : []),
    `${changes.mergeBase}..${changes.headCommit}`,
    '--',
    ...paths,
  ]);
  if (!r.ok) return { ...NO_CHANGE(), status: file.status };
  return { status: file.status, ...parseHunks(r.stdout) };
}
