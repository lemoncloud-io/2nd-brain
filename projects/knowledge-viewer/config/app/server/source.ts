// 문서를 어디서 읽는가(디스크·origin/master·PR). 리더 하나가 읽기·존재·목록을 한 소스로 묶는다.
// git 소스는 리더를 만들 때 커밋 oid 를 하나로 고정한다 — 읽는 도중 fetch 가 와도 한 스냅숏을 본다.
// 경로 검사(segmentsBlocked 의 `..`·제외 폴더·private·대소문자 규칙)는 소스와 무관하게 먼저 적용한다.
import fs from 'node:fs';

import type { Source } from '../shared/source.ts';
import { sourceKey } from '../shared/source.ts';
import { splitFrontmatter, titleOf } from '../shared/frontmatter.ts';
import { isRawImagePath } from '../shared/image-src.ts';
import { EXCLUDED_TOP, kindOf, listDir, segmentsBlocked, walkDisk, walkLint } from '../shared/scope.ts';
import type { Entry } from '../shared/types.ts';
import { git, gitAsync, gitBytes, type GitAsyncFn } from './git.ts';
import { isFileInside, resolveDiskPath } from './handlers.ts';
import { reasonOf, spawnGh, type GhRunner } from './panels/prs.ts';
import { SourceResolver } from './source-resolver.ts';

export type SourceReader = {
  kind: Source['kind'];
  /** git ref(이름). 디스크면 null. */
  ref: string | null;
  /** 짧은 커밋 oid. 디스크면 HEAD 의 것, 저장소가 아니면 null. */
  head: string | null;
  readText(rel: string): string | null;
  readBytes(rel: string): Buffer | null;
  /** 읽을 수 있는 일반 파일이 있는가(폴더·심링크·범위 밖은 false). */
  exists(rel: string): boolean;
  /** 폴더 한 층. 범위 밖·없는 폴더는 예외다(listDir 와 같다). */
  list(dir: string): Entry[];
  /** lint 범위의 md(정렬). */
  listAll(): string[];
  /** 읽을 수 있는 이미지 파일(정렬, RAW_IMAGE_EXT). 위키 이미지 임베드(`![[그림.png]]`) 풀이에만 쓴다. 없으면 이미지 임베드는 풀리지 않는다. */
  listImages?(): string[];
  /** git 리더만: 경로 → blob oid. list 로 이미 본 경로는 spawn 하지 않는다. 범위 밖·없음은 빠진다. */
  blobOids?(paths: string[]): Map<string, string>;
  /** git 리더만: blob oid → 내용(utf8). `cat-file --batch` 한 번이다. 못 읽은 것은 빠진다. */
  readBlobs?(oids: string[]): Map<string, string>;
};

export type SourceStatus = { available: boolean; head: string | null; fetchedAt: number | null; reason?: string };

export type PrMeta = {
  number: number;
  title: string;
  author: string;
  head: string;
  base: string;
  headOid: string;
  updatedAt: string;
  url: string;
};

export const MAIN_REF = 'refs/remotes/origin/master';
export const prRef = (n: number): string => `refs/kv/pr/${n}`;
export const baseRef = (branch: string): string => `refs/kv/base/${branch}`;
export const FETCH_TTL_MS = 60_000;
const PR_FIELDS = 'number,title,author,headRefName,baseRefName,headRefOid,updatedAt,url';

type GitFn = typeof git;
const GIT_SCOPE = { includePrivate: false };

/**
 * 사람에게 보일 사유. stderr 의 첫 줄만 남기고 절대경로(`/Users/…`·`/private/…`·origin 경로 등)는 `<path>` 로 가린다.
 * 경로 끝에 붙은 `:`·`,`·`.`·`;` 는 문장 부호로 보고 남긴다. URL(`https://…`)은 건드리지 않는다.
 */
export function redactReason(stderr: string): string {
  const line = stderr.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
  // `file:///…` 도 로컬 절대경로다 — 통째로 가린다.
  return line.replace(/(^|[\s'"(=])((?:file:\/\/)?\/[^\s'"()]+)/g, (_m, pre: string, body: string) => {
    const tail = /[:,.;]+$/.exec(body)?.[0] ?? '';
    return `${pre}<path>${tail}`;
  });
}

/** 커밋 ref 를 전체 oid 로. 없으면 null. */
function resolveCommit(root: string, ref: string, run: GitFn): string | null {
  const r = run(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  const oid = r.stdout.trim();
  return r.ok && oid !== '' ? oid : null;
}

function shortOf(root: string, ref: string, run: GitFn): string | null {
  const r = run(root, ['rev-parse', '--short', '--verify', '--quiet', `${ref}^{commit}`]);
  const oid = r.stdout.trim();
  return r.ok && oid !== '' ? oid : null;
}

/** 값을 한 번만 계산하는 게터. 리더를 만들 때 spawn 하지 않으려는 것이다. */
function lazy<T>(f: () => T): () => T {
  let done = false;
  let v: T;
  return () => {
    if (!done) {
      v = f();
      done = true;
    }
    return v;
  };
}

export function localReader(root: string, includePrivate: boolean, run: GitFn = git): SourceReader {
  const ctx = { root, includePrivate };
  const file = (rel: string): string | null => {
    const abs = resolveDiskPath(ctx, rel);
    return abs !== null && isFileInside(root, abs) ? abs : null;
  };
  const head = lazy(() => shortOf(root, 'HEAD', run));
  return {
    kind: 'local',
    ref: null,
    get head() {
      return head();
    },
    readText(rel) {
      const abs = file(rel);
      if (abs === null) return null;
      try {
        return fs.readFileSync(abs, 'utf8');
      } catch {
        return null;
      }
    },
    readBytes(rel) {
      const abs = file(rel);
      if (abs === null) return null;
      try {
        return fs.readFileSync(abs);
      } catch {
        return null;
      }
    },
    exists: (rel) => file(rel) !== null,
    list: (dir) => listDir(root, dir, ctx),
    listAll: () => walkLint(root),
    // 디스크 범위(private 는 includePrivate 일 때만). raw·archive 도 /raw 로 읽히므로 빼지 않는다.
    listImages: () => walkDisk(root, ctx).filter(isRawImagePath),
  };
}

type TreeRec = { mode: string; type: string; oid: string; path: string };

/** `ls-tree -z` 출력(`<mode> <type> <oid>\t<path>` NUL 구분)을 푼다. */
function parseTree(out: string): TreeRec[] {
  const recs: TreeRec[] = [];
  for (const rec of out.split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const [mode, type, oid] = rec.slice(0, tab).split(' ');
    if (mode === undefined || type === undefined || oid === undefined) continue;
    recs.push({ mode, type, oid, path: rec.slice(tab + 1) });
  }
  return recs;
}

/** 심링크(120000)·서브모듈(commit)이 아닌 일반 파일인가. */
const isPlainBlob = (r: TreeRec): boolean => r.type === 'blob' && r.mode !== '120000';

// 머리 oid 별 listAll·listImages 캐시. 커밋은 바뀌지 않으므로 무효화가 필요 없다 — 크기만 묶는다.
const LIST_ALL_CACHE = new Map<string, string[]>();
const LIST_IMAGES_CACHE = new Map<string, string[]>();
const LIST_ALL_CACHE_MAX = 32;

function remember(cache: Map<string, string[]>, key: string, value: string[]): void {
  if (cache.size >= LIST_ALL_CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
}

export type GitReaderOptions = {
  kind?: 'main' | 'pr';
  git?: GitFn;
  gitBytes?: typeof gitBytes;
  /** 이미 푼 커밋 oid. */
  oid?: string | null;
};

/** `cat-file --batch` 출력(`<oid> blob <size>\n<내용>\n` 반복, 없으면 `<oid> missing\n`)을 푼다. */
export function parseCatFileBatch(out: Buffer): Map<string, string> {
  const blobs = new Map<string, string>();
  let i = 0;
  while (i < out.length) {
    const nl = out.indexOf(0x0a, i);
    if (nl < 0) break;
    const [oid, type, size] = out.subarray(i, nl).toString('utf8').split(' ');
    i = nl + 1;
    if (oid === undefined || type === undefined || size === undefined) continue; // `<oid> missing`
    const n = Number(size);
    if (!Number.isInteger(n) || n < 0 || i + n > out.length) break;
    if (type === 'blob') blobs.set(oid, out.subarray(i, i + n).toString('utf8'));
    i += n + 1;
  }
  return blobs;
}

const OID = /^[0-9a-f]{40,64}$/;

export function gitReader(root: string, ref: string, opts: GitReaderOptions = {}): SourceReader {
  const run = opts.git ?? git;
  const runBytes = opts.gitBytes ?? gitBytes;
  /** list 가 본 경로 → blob oid. 리더는 커밋 하나에 묶여 있으므로 무효화하지 않는다. */
  const seen = new Map<string, string>();
  const kind = opts.kind ?? (ref.startsWith('refs/kv/pr/') ? 'pr' : 'main');
  const oid = opts.oid !== undefined ? opts.oid : resolveCommit(root, ref, run);
  const head = lazy(() => (oid === null ? null : shortOf(root, oid, run)));
  /** `ls-tree -z --full-tree <flags> <oid> -- <paths>`. 경로는 문자 그대로(pathspec 해석 없음) 넘긴다. */
  const lsTree = (flags: string[], paths: string[]): TreeRec[] | null => {
    if (oid === null) return null;
    const r = run(root, ['--literal-pathspecs', 'ls-tree', '-z', '--full-tree', ...flags, oid, '--', ...paths]);
    return r.ok ? parseTree(r.stdout) : null;
  };
  /** 읽을 수 있는 blob 의 oid. 범위 밖·없음·폴더·심링크면 null. */
  const blobOf = (rel: string): string | null => {
    if (segmentsBlocked(rel.split('/'), GIT_SCOPE)) return null;
    const recs = lsTree([], [rel]);
    const hit = recs?.find((r) => r.path === rel);
    return hit !== undefined && isPlainBlob(hit) ? hit.oid : null;
  };
  return {
    kind,
    ref,
    get head() {
      return head();
    },
    readText(rel) {
      const blob = blobOf(rel);
      if (blob === null) return null;
      const r = run(root, ['cat-file', 'blob', blob]);
      return r.ok ? r.stdout : null;
    },
    readBytes(rel) {
      const blob = blobOf(rel);
      return blob === null ? null : runBytes(root, ['cat-file', 'blob', blob]);
    },
    exists: (rel) => blobOf(rel) !== null,
    list(rawDir) {
      const segs = rawDir.split('/').filter((s) => s !== '' && s !== '.');
      const dir = segs.join('/');
      if (segs.length > 0 && segmentsBlocked(segs, GIT_SCOPE)) throw new Error(`열 수 없는 폴더다: ${dir}`);
      const recs = lsTree([], dir === '' ? [] : [`${dir}/`]);
      if (recs === null) throw new Error(`트리를 읽지 못했다: ${ref}`);
      if (dir !== '' && recs.length === 0) throw new Error(`폴더가 없다: ${dir}`);
      const prefix = dir === '' ? '' : `${dir}/`;
      const dirs: Entry[] = [];
      const files: Entry[] = [];
      for (const r of recs) {
        if (!r.path.startsWith(prefix)) continue;
        const name = r.path.slice(prefix.length);
        if (name === '' || name.includes('/') || name.startsWith('.')) continue;
        if (segmentsBlocked([...segs, name], GIT_SCOPE)) continue;
        if (r.type === 'tree') dirs.push({ name, path: r.path, kind: 'dir', ignored: false });
        else if (isPlainBlob(r)) {
          files.push({ name, path: r.path, kind: kindOf(name), ignored: false });
          seen.set(r.path, r.oid);
        }
      }
      const byName = (a: Entry, b: Entry): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      return [...dirs.sort(byName), ...files.sort(byName)];
    },
    listAll() {
      if (oid === null) return [];
      const key = `${root}\0${oid}`;
      const hit = LIST_ALL_CACHE.get(key);
      if (hit !== undefined) return hit.slice();
      const recs = lsTree(['-r'], []);
      if (recs === null) return [];
      const out = recs
        .filter((r) => isPlainBlob(r) && r.path.endsWith('.md'))
        .map((r) => r.path)
        .filter((p) => {
          const segs = p.split('/');
          if (segs.length > 1 && EXCLUDED_TOP.includes(segs[0]!)) return false;
          return !segmentsBlocked(segs, GIT_SCOPE);
        })
        .sort();
      remember(LIST_ALL_CACHE, key, out);
      return out.slice();
    },
    listImages() {
      if (oid === null) return [];
      const key = `${root}\0${oid}`;
      const hit = LIST_IMAGES_CACHE.get(key);
      if (hit !== undefined) return hit.slice();
      const recs = lsTree(['-r'], []);
      if (recs === null) return [];
      // git 소스는 private 를 담지 않는다(GIT_SCOPE). raw·archive 이미지는 /raw/@… 로 읽히므로 남긴다.
      const out = recs
        .filter((r) => isPlainBlob(r) && isRawImagePath(r.path) && !segmentsBlocked(r.path.split('/'), GIT_SCOPE))
        .map((r) => r.path)
        .sort();
      remember(LIST_IMAGES_CACHE, key, out);
      return out.slice();
    },
    blobOids(paths) {
      const out = new Map<string, string>();
      const missing: string[] = [];
      for (const p of paths) {
        if (segmentsBlocked(p.split('/'), GIT_SCOPE)) continue;
        const hit = seen.get(p);
        if (hit !== undefined) out.set(p, hit);
        else missing.push(p);
      }
      if (missing.length > 0) {
        for (const r of lsTree([], missing) ?? []) {
          if (!missing.includes(r.path) || !isPlainBlob(r)) continue;
          seen.set(r.path, r.oid);
          out.set(r.path, r.oid);
        }
      }
      return out;
    },
    readBlobs(oids) {
      const want = [...new Set(oids)].filter((o) => OID.test(o));
      if (want.length === 0) return new Map();
      const out = runBytes(root, ['cat-file', '--batch'], { input: want.join('\n') + '\n' });
      return out === null ? new Map() : parseCatFileBatch(out);
    },
  };
}

type FetchState = { at: number; sig: string; ok: boolean; reason?: string; okAt: number | null };
type Cached<T> = { at: number; value: T };

export type SourceManagerDeps = {
  git?: GitFn;
  gitBytes?: typeof gitBytes;
  /**
   * fetch 만 도는 비동기 러너. 기본은 gitAsync(이벤트 루프를 막지 않는다).
   * `git` 만 주면 그것을 감싸 쓴다 — 시험의 fetch 스파이가 그대로 센다.
   */
  fetchGit?: GitAsyncFn;
  gh?: GhRunner;
  now?: () => number;
  ttlMs?: number;
};

const RESOLVER_CACHE_MAX = 32;
const TITLE_CACHE_MAX = 2000;

/** 크기를 묶은 Map 에 넣는다. 가득 차면 가장 먼저 넣은 것을 뺀다. */
function putCapped<V>(m: Map<string, V>, max: number, key: string, value: V): void {
  if (!m.has(key) && m.size >= max) m.delete(m.keys().next().value!);
  m.set(key, value);
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const asLogin = (v: unknown): string => (typeof v === 'object' && v !== null ? str((v as { login?: unknown }).login) : '');

/**
 * 소스 → 리더. main·pr 은 origin 에서 fetch 한 뒤(소스별 ttl 캐시, 실패도 캐시) 받은 ref 를 읽는다.
 * fetch 가 실패해도 옛 ref 가 있으면 리더를 주고 status 에 사유를 남긴다. ref 가 없으면 {error}.
 */
export class SourceManager {
  private readonly root: string;
  private readonly git: GitFn;
  private readonly gitBytes: typeof gitBytes;
  private readonly fetchGit: GitAsyncFn;
  private readonly gh: GhRunner;
  private readonly now: () => number;
  private readonly ttl: number;
  private readonly fetches = new Map<string, FetchState>();
  /** 진행 중인 fetch. 같은 소스의 동시 요청은 한 약속을 나눠 쓴다. */
  private readonly fetchInflight = new Map<string, Promise<void>>();
  private readonly metas = new Map<number, Cached<PrMeta | { error: string }>>();
  /** 진행 중인 gh 호출. 같은 PR 의 동시 요청은 한 약속을 나눠 쓴다. */
  private readonly metaInflight = new Map<number, Promise<PrMeta | { error: string }>>();
  /** 머리 oid 별 링크 해석기. 커밋은 바뀌지 않으므로 무효화하지 않는다. */
  private readonly resolvers = new Map<string, SourceResolver>();
  /**
   * `<blob oid>\0<경로>` → 제목. git 소스의 트리 제목용이다. 머리가 바뀌어도 내용이 같은 파일은 다시 읽지 않는다.
   * 경로를 키에 넣는 것은 제목이 없을 때 파일 이름으로 떨어지기 때문이다(같은 blob 도 경로마다 제목이 다르다).
   */
  private readonly titles = new Map<string, string>();

  constructor(root: string, deps: SourceManagerDeps = {}) {
    this.root = root;
    this.git = deps.git ?? git;
    this.gitBytes = deps.gitBytes ?? gitBytes;
    const sync = deps.git;
    this.fetchGit = deps.fetchGit ?? (sync !== undefined ? async (r, a, o) => sync(r, a, o) : gitAsync);
    this.gh = deps.gh ?? spawnGh;
    this.now = deps.now ?? Date.now;
    this.ttl = deps.ttlMs ?? FETCH_TTL_MS;
  }

  /**
   * stale-while-revalidate: ref 가 이미 있으면 그 커밋으로 리더를 바로 주고, ttl 이 지났으면 뒤에서 fetch 한다.
   * ref 가 없을 때만 fetch 를 기다린다. fetch 는 비동기(spawn)라 그동안 다른 요청도 답한다.
   */
  async reader(src: Source, includePrivate: boolean): Promise<SourceReader | { error: string }> {
    if (src.kind === 'local') return localReader(this.root, includePrivate, this.git);
    if (src.kind === 'main') return this.openFresh('main', MAIN_REF, 'main', ['fetch', 'origin', 'master']);
    const n = src.number;
    const meta = await this.prMeta(n);
    if ('error' in meta) return { error: meta.error };
    if (!this.isBranchName(meta.base)) return { error: `base 브랜치 이름이 올바르지 않다: ${meta.base}` };
    return this.openFresh(
      sourceKey(src),
      prRef(n),
      'pr',
      ['fetch', 'origin', `+refs/pull/${n}/head:${prRef(n)}`, `+refs/heads/${meta.base}:${baseRef(meta.base)}`],
      [baseRef(meta.base)],
    );
  }

  /** 진행 중인 fetch 가 모두 끝날 때까지 기다린다(시험·종료용). */
  async idle(): Promise<void> {
    while (this.fetchInflight.size > 0) await Promise.all([...this.fetchInflight.values()]);
  }

  status(src: Source): SourceStatus {
    if (src.kind === 'local') return { available: true, head: shortOf(this.root, 'HEAD', this.git), fetchedAt: null };
    const key = sourceKey(src);
    const ref = src.kind === 'main' ? MAIN_REF : prRef(src.number);
    const head = shortOf(this.root, ref, this.git);
    const state = this.fetches.get(key);
    const out: SourceStatus = { available: head !== null, head, fetchedAt: state?.okAt ?? null };
    const meta = src.kind === 'pr' ? this.metas.get(src.number)?.value : undefined;
    let reason: string | undefined;
    if (state !== undefined && !state.ok) reason = state.reason;
    else if (meta !== undefined && 'error' in meta) reason = meta.error;
    else if (head === null) reason = `ref 가 없다: ${ref}`;
    if (reason !== undefined) out.reason = reason;
    return out;
  }

  async prMeta(n: number): Promise<PrMeta | { error: string }> {
    const hit = this.metas.get(n);
    if (hit !== undefined && this.now() - hit.at <= this.ttl) return hit.value;
    const pending = this.metaInflight.get(n);
    if (pending !== undefined) return pending;
    // `await null` 로 첫 작업을 다음 틱으로 미룬다 — gh 가 동기로 던져도 set 이 delete 보다 먼저다.
    const p = (async (): Promise<PrMeta | { error: string }> => {
      await null;
      try {
        const r = await this.gh(['pr', 'view', String(n), '--json', PR_FIELDS], this.root);
        const value = r.status === 0 && !r.error ? parseMeta(r.stdout, n) : { error: redactReason(reasonOf(r)) };
        this.metas.set(n, { at: this.now(), value });
        return value;
      } catch (e) {
        // 러너 예외(동기 throw·reject)는 캐시하지 않는다 — 다음 호출이 다시 시도한다.
        return { error: redactReason(`gh 실패: ${e instanceof Error ? e.message : String(e)}`) };
      } finally {
        this.metaInflight.delete(n);
      }
    })();
    this.metaInflight.set(n, p);
    return p;
  }

  /** git 리더의 파일 집합으로 링크를 푸는 해석기. 머리 oid 가 같으면 다시 만들지 않는다. */
  resolverFor(reader: SourceReader, aliasLookup?: (nameLower: string) => string[]): SourceResolver {
    const head = reader.head;
    if (head === null) return new SourceResolver(reader.listAll(), aliasLookup);
    const key = `${reader.ref ?? ''}\0${head}`;
    const hit = this.resolvers.get(key);
    if (hit !== undefined) return hit;
    const made = new SourceResolver(reader.listAll(), aliasLookup);
    putCapped(this.resolvers, RESOLVER_CACHE_MAX, key, made);
    return made;
  }

  /**
   * git 리더의 md 제목들(경로 → 제목). 못 읽은 경로는 빠진다.
   * 캐시 키는 blob oid 라 머리가 바뀌어도 그대로인 파일은 다시 읽지 않는다. 없는 것은 `cat-file --batch` 한 번에 읽는다.
   */
  titlesFor(reader: SourceReader, paths: string[]): Map<string, string> {
    const out = new Map<string, string>();
    const titleFrom = (rel: string, text: string): string => {
      const { data, body } = splitFrontmatter(text);
      return titleOf(rel, data, body);
    };
    if (reader.blobOids === undefined || reader.readBlobs === undefined) {
      for (const rel of paths) {
        const text = reader.readText(rel);
        if (text !== null) out.set(rel, titleFrom(rel, text));
      }
      return out;
    }
    const oids = reader.blobOids(paths);
    const missing: [string, string][] = [];
    for (const [rel, oid] of oids) {
      const hit = this.titles.get(`${oid}\0${rel}`);
      if (hit !== undefined) out.set(rel, hit);
      else missing.push([rel, oid]);
    }
    if (missing.length === 0) return out;
    const texts = reader.readBlobs(missing.map(([, oid]) => oid));
    for (const [rel, oid] of missing) {
      const text = texts.get(oid);
      if (text === undefined) continue;
      const title = titleFrom(rel, text);
      putCapped(this.titles, TITLE_CACHE_MAX, `${oid}\0${rel}`, title);
      out.set(rel, title);
    }
    return out;
  }

  /** ttl 이 지났거나 refspec 이 바뀌었으면 true. */
  private due(key: string, sig: string): boolean {
    const prev = this.fetches.get(key);
    return prev === undefined || prev.sig !== sig || this.now() - prev.at > this.ttl;
  }

  /** fetch 를 한 번 돌린다(진행 중이면 그 약속). 거부하지 않는다 — 실패는 상태(reason)로 남는다. */
  private refresh(key: string, args: string[]): Promise<void> {
    const pending = this.fetchInflight.get(key);
    if (pending !== undefined) return pending;
    const sig = args.join('\0');
    const p = (async (): Promise<void> => {
      await null;
      let r: { ok: boolean; stderr: string };
      try {
        r = await this.fetchGit(this.root, args);
      } catch (e) {
        r = { ok: false, stderr: e instanceof Error ? e.message : String(e) };
      }
      const prev = this.fetches.get(key);
      const at = this.now();
      const state: FetchState = { at, sig, ok: r.ok, okAt: r.ok ? at : (prev?.okAt ?? null) };
      if (!r.ok) state.reason = `fetch 실패: ${redactReason(r.stderr) || 'git 오류'}`;
      this.fetches.set(key, state);
    })().finally(() => this.fetchInflight.delete(key));
    this.fetchInflight.set(key, p);
    return p;
  }

  /** ref 가 있으면 바로 리더(필요하면 뒤에서 갱신), 없으면 fetch 를 기다린 뒤 리더 또는 {error}. */
  /**
   * ref 가 있으면 바로 리더를 주고 TTL 이 지났으면 뒤에서 갱신한다. ref 나 `alsoRefs`(pr 의 base ref) 중 하나라도
   * 없으면 fetch 를 기다린다 — base 브랜치가 바뀐 직후 "ref 가 없다" 가 잠깐 새지 않게.
   */
  private async openFresh(
    key: string,
    ref: string,
    kind: 'main' | 'pr',
    args: string[],
    alsoRefs: string[] = [],
  ): Promise<SourceReader | { error: string }> {
    const due = this.due(key, args.join('\0'));
    let oid = resolveCommit(this.root, ref, this.git);
    const ready = oid !== null && alsoRefs.every((r) => resolveCommit(this.root, r, this.git) !== null);
    if (ready) {
      if (due) void this.refresh(key, args);
    } else {
      if (due || this.fetchInflight.has(key)) await this.refresh(key, args);
      oid = resolveCommit(this.root, ref, this.git);
    }
    if (oid === null) {
      const state = this.fetches.get(key);
      return { error: state?.reason ?? `ref 가 없다: ${ref}` };
    }
    return gitReader(this.root, ref, { kind, git: this.git, gitBytes: this.gitBytes, oid });
  }

  private isBranchName(name: string): boolean {
    if (name === '' || name.startsWith('-')) return false;
    return this.git(this.root, ['check-ref-format', `refs/heads/${name}`]).ok;
  }
}

function parseMeta(stdout: string, n: number): PrMeta | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    return { error: 'gh 실패: 응답이 JSON 이 아니다' };
  }
  if (typeof json !== 'object' || json === null) return { error: 'gh 실패: 응답이 JSON 이 아니다' };
  const o = json as Record<string, unknown>;
  const meta: PrMeta = {
    number: typeof o.number === 'number' ? o.number : 0,
    title: str(o.title),
    author: asLogin(o.author),
    head: str(o.headRefName),
    base: str(o.baseRefName),
    headOid: str(o.headRefOid),
    updatedAt: str(o.updatedAt),
    url: str(o.url),
  };
  if (meta.number !== n || meta.base === '' || meta.head === '') return { error: `gh 실패: PR #${n} 의 응답이 올바르지 않다` };
  return meta;
}
