// PR 패널의 데이터 소스. gh CLI 를 spawn 해 열린 PR 과 바뀐 파일을 읽고 30초 캐시한다.
// 토큰은 어디에도 두지 않는다 — gh 의 인증을 그대로 쓴다. 러너는 주입 가능해서 시험은 스텁을 준다.
import { spawn } from 'node:child_process';

import { isFileInside, resolveDiskPath } from '../handlers.ts';

export type GhResult = {
  stdout: string;
  stderr: string;
  status: number | null;
  signal?: NodeJS.Signals | null;
  error?: NodeJS.ErrnoException;
};
export type GhRunner = (args: string[], cwd: string) => Promise<GhResult>;

export type Pr = {
  number: number;
  title: string;
  assignees: string[];
  author: string;
  headRefName: string;
  updatedAt: string;
  url: string;
  isDraft: boolean;
};
export type PrFile = { path: string; md: boolean; viewable: boolean };
export type PrListResult = { repo: string | null; prs: Pr[]; truncated: boolean; fetchedAt: string; error: string | null };
export type PrFilesResult = { repo: string | null; number: number; files: PrFile[]; truncated: boolean; error: string | null };
export type PrReposResult = { repos: string[]; vaultRepo: string | null; error: string | null };

export const GH_TIMEOUT_MS = 15_000;
export const PR_LIMIT = 100;
export const DEFAULT_TTL_MS = 30_000;
const LIST_FIELDS = 'number,title,assignees,author,headRefName,updatedAt,url,isDraft';
const NOT_JSON = 'gh 실패: 응답이 JSON 이 아니다';

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const isRepoName = (s: string): boolean => REPO_RE.test(s) && !s.startsWith('-');

/** CLI 가 하나라도 있으면 env 는 무시한다(합치지 않는다). 형식이 틀리면 throw — 시작 때 멈추게. */
export function parseRepos(cli: string[], env: string | undefined): string[] {
  const list = cli.length > 0 ? cli : (env ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
  for (const r of list) if (!isRepoName(r)) throw new Error(`레포 이름이 올바르지 않다(owner/name): ${r}`);
  return list;
}

/** 실제 gh 를 spawn 하는 러너. bin 은 시험이 바꾼다. */
export function makeSpawnRunner(bin: string): GhRunner {
  return (args, cwd) =>
    new Promise((resolve) => {
      const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, killSignal: 'SIGTERM' });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
      child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
      let done = false;
      const finish = (r: GhResult): void => {
        if (done) return;
        done = true;
        resolve(r);
      };
      child.on('error', (error: NodeJS.ErrnoException) => finish({ stdout, stderr, status: null, signal: null, error }));
      child.on('close', (status, signal) => finish({ stdout, stderr, status, signal }));
    });
}

export const spawnGh: GhRunner = makeSpawnRunner('gh');

/** 실패를 사람이 읽을 한 줄로. 규칙은 설계서 § 서버. */
export function reasonOf(r: GhResult): string {
  if (r.error?.code === 'ENOENT') return 'gh 없음';
  if (r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM') return '시간 초과';
  if (r.error) return `gh 실패: ${r.error.message}`;
  if (/gh auth login/.test(r.stderr)) return 'gh 미인증';
  const first = r.stderr.split('\n').find((l) => l.trim() !== '')?.trim();
  return `gh 실패: ${first ?? `exit ${r.status}`}`;
}

const asLogin = (v: unknown): string => (typeof v === 'object' && v !== null && typeof (v as { login?: unknown }).login === 'string' ? (v as { login: string }).login : '');
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function parsePrList(stdout: string): { prs: Pr[] } | { error: string } {
  const json = tryJson(stdout);
  if (!Array.isArray(json)) return { error: NOT_JSON };
  const prs: Pr[] = json.map((raw) => {
    const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    return {
      number: typeof o.number === 'number' ? o.number : 0,
      title: str(o.title),
      assignees: Array.isArray(o.assignees) ? o.assignees.map(asLogin).filter((s) => s !== '') : [],
      author: asLogin(o.author),
      headRefName: str(o.headRefName),
      updatedAt: str(o.updatedAt),
      url: str(o.url),
      isDraft: o.isDraft === true,
    };
  });
  prs.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return { prs };
}

export function parsePrFiles(stdout: string): { paths: string[]; changedFiles: number } | { error: string } {
  const json = tryJson(stdout);
  if (typeof json !== 'object' || json === null || !Array.isArray((json as { files?: unknown }).files)) return { error: NOT_JSON };
  const o = json as { files: unknown[]; changedFiles?: unknown };
  const paths = o.files.map((f) => str((f as { path?: unknown })?.path)).filter((p) => p !== '');
  return { paths, changedFiles: typeof o.changedFiles === 'number' ? o.changedFiles : paths.length };
}

type Cached<T> = { at: number; value: T };

export type PrSourceOptions = {
  root: string;
  includePrivate: boolean;
  /** 허용 레포 목록. 비면 볼트 레포 하나(gh repo view). */
  repos: string[];
  gh: GhRunner;
  now?: () => number;
  ttlMs?: number;
};

export class PrSource {
  private readonly root: string;
  private readonly includePrivate: boolean;
  private readonly fixedRepos: string[];
  private readonly gh: GhRunner;
  private readonly now: () => number;
  private readonly ttl: number;
  private readonly cache = new Map<string, Cached<unknown>>();
  /** 볼트 레포. 성공은 영구, 실패는 ttl 동안 캐시한다. */
  private vault: { at: number; repo: string | null; reason: string | null } | null = null;

  constructor(opts: PrSourceOptions) {
    this.root = opts.root;
    this.includePrivate = opts.includePrivate;
    this.fixedRepos = opts.repos;
    this.gh = opts.gh;
    this.now = opts.now ?? Date.now;
    this.ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  }

  private fresh<T>(key: string, refresh: boolean): T | undefined {
    if (refresh) return undefined;
    const hit = this.cache.get(key);
    return hit && this.now() - hit.at < this.ttl ? (hit.value as T) : undefined;
  }

  private put<T>(key: string, value: T): T {
    this.cache.set(key, { at: this.now(), value });
    return value;
  }

  private async vaultRepo(refresh: boolean): Promise<{ repo: string | null; reason: string | null }> {
    const v = this.vault;
    if (v && !refresh && (v.repo !== null || this.now() - v.at < this.ttl)) return v;
    const r = await this.gh(['repo', 'view', '--json', 'nameWithOwner'], this.root);
    let repo: string | null = null;
    let reason: string | null = null;
    if (r.status === 0 && !r.error) {
      const json = tryJson(r.stdout) as { nameWithOwner?: unknown } | undefined;
      if (json && typeof json.nameWithOwner === 'string' && isRepoName(json.nameWithOwner)) repo = json.nameWithOwner;
      else reason = NOT_JSON;
    } else {
      // gh 없음·미인증·시간 초과는 그대로 전한다. 그 밖(원격 없음·여럿·GitHub 아님)만 "레포를 못 찾았다"다.
      const base = reasonOf(r);
      reason = base.startsWith('gh 실패: ') ? `레포를 못 찾았다: ${base.slice('gh 실패: '.length)}` : base;
    }
    this.vault = { at: this.now(), repo, reason };
    return this.vault;
  }

  async repos(refresh = false): Promise<PrReposResult> {
    const v = await this.vaultRepo(refresh);
    if (this.fixedRepos.length > 0) return { repos: this.fixedRepos, vaultRepo: v.repo, error: null };
    if (v.repo === null) return { repos: [], vaultRepo: null, error: v.reason ?? '레포를 못 찾았다' };
    return { repos: [v.repo], vaultRepo: v.repo, error: null };
  }

  /**
   * 질의의 repo 를 허용 목록에 맞춘다. null 이면 첫 항목. 목록 밖이면 throw(라우트가 400 으로 바꾼다).
   * 볼트 레포(gh repo view)는 needVault 일 때만 알아본다 — 목록 조회는 그것 없이 돈다.
   */
  private async pick(repo: string | null, refresh: boolean, needVault: boolean): Promise<{ repo: string | null; vaultRepo: string | null; error: string | null }> {
    if (this.fixedRepos.length > 0) {
      if (repo !== null && !this.fixedRepos.includes(repo)) throw new Error(`허용되지 않은 레포다: ${repo}`);
      const vaultRepo = needVault ? (await this.vaultRepo(refresh)).repo : null;
      return { repo: repo ?? this.fixedRepos[0]!, vaultRepo, error: null };
    }
    const v = await this.vaultRepo(refresh);
    if (v.repo === null) return { repo: null, vaultRepo: null, error: v.reason ?? '레포를 못 찾았다' };
    if (repo !== null && repo !== v.repo) throw new Error(`허용되지 않은 레포다: ${repo}`);
    return { repo: v.repo, vaultRepo: v.repo, error: null };
  }

  async list(repo: string | null, refresh = false): Promise<PrListResult> {
    const fetchedAt = new Date(this.now()).toISOString();
    const p = await this.pick(repo, refresh, false);
    if (p.repo === null) return { repo: null, prs: [], truncated: false, fetchedAt, error: p.error ?? '레포를 못 찾았다' };
    const key = `list:${p.repo}`;
    const hit = this.fresh<PrListResult>(key, refresh);
    if (hit) return hit;
    const r = await this.gh(['pr', 'list', '--repo', p.repo, '--state', 'open', '--limit', String(PR_LIMIT), '--json', LIST_FIELDS], this.root);
    if (r.error || r.status !== 0) return this.put(key, { repo: p.repo, prs: [], truncated: false, fetchedAt, error: reasonOf(r) });
    const parsed = parsePrList(r.stdout);
    if ('error' in parsed) return this.put(key, { repo: p.repo, prs: [], truncated: false, fetchedAt, error: parsed.error });
    return this.put(key, { repo: p.repo, prs: parsed.prs, truncated: parsed.prs.length >= PR_LIMIT, fetchedAt, error: null });
  }

  async files(repo: string | null, number: number, refresh = false): Promise<PrFilesResult> {
    const p = await this.pick(repo, refresh, true);
    if (p.repo === null) return { repo: null, number, files: [], truncated: false, error: p.error ?? '레포를 못 찾았다' };
    const key = `files:${p.repo}#${number}`;
    const hit = this.fresh<PrFilesResult>(key, refresh);
    if (hit) return hit;
    const r = await this.gh(['pr', 'view', String(number), '--repo', p.repo, '--json', 'files,changedFiles'], this.root);
    if (r.error || r.status !== 0) return this.put(key, { repo: p.repo, number, files: [], truncated: false, error: reasonOf(r) });
    const parsed = parsePrFiles(r.stdout);
    if ('error' in parsed) return this.put(key, { repo: p.repo, number, files: [], truncated: false, error: parsed.error });
    const own = p.repo === p.vaultRepo;
    const files: PrFile[] = parsed.paths.map((path) => {
      const md = path.endsWith('.md');
      let viewable = false;
      if (own && md) {
        const abs = resolveDiskPath({ root: this.root, includePrivate: this.includePrivate }, path);
        viewable = abs !== null && isFileInside(this.root, abs);
      }
      return { path, md, viewable };
    });
    return this.put(key, { repo: p.repo, number, files, truncated: files.length < parsed.changedFiles, error: null });
  }
}
