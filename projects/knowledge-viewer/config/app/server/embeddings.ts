// 임베딩 묶음(설계서 § 2차 소스 `embedding`). 로컬 Ollama 로 본문을 벡터화하고, 볼트 밖 캐시에 두고, k-means 로 군집 번호를 낸다.
// 본문은 루프백 Ollama 로만 간다 — 다른 주소는 만들 때 거부한다. 서버 시작 때는 아무것도 하지 않는다(사용자가 켤 때 색인한다).
// 지도와 같은 범위(lint 범위 + inGraphScope)만 본다: private·raw·archive·제외 폴더는 색인하지 않는다. 늘 디스크 색인(로컬 본문)이다.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { EXCLUDED_TOP } from '../shared/scope.ts';
import { inGraphScope } from './graph.ts';
import type { VaultIndex } from './index-store.ts';
import { kFor, kmeans } from './kmeans.ts';

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
/**
 * EmbeddingGemma 2(Ollama `embeddinggemma-2`, 100+ 언어, 768차원) 의 텍스트 전용 270M·q8_0 변형. 오너 지시 2026-10-24 — 설계서의 `bge-m3` 를 바꿨다.
 * 모든 크기(270m·440m·570m·740m)가 같은 270M 텍스트 백본이고 큰 변형은 이미지·오디오 인코더를 더할 뿐이라, 글만 다루는 지도에는 가장 작은 것이 같은 품질이다.
 */
export const DEFAULT_EMBED_MODEL = 'embeddinggemma-2:270m-q8_0-text';
/** 본문 앞 몇 자를 벡터화하는가. EmbeddingGemma 2 맥락은 8,192 토큰이다 — 2,000 자는 Ollama 기본 맥락에도 넉넉히 들어간다(넘치면 Ollama 가 자른다). */
export const EMBED_CHARS = 2000;
export const EMBED_CONCURRENCY = 4;
/** 요청 하나에 싣는 문서 수. 실패하면 그 묶음을 한 문서씩 다시 보낸다. */
export const EMBED_BATCH = 8;
const CACHE_SCHEMA = 1;
const PROBE_TIMEOUT_MS = 2_000;
const EMBED_TIMEOUT_MS = 120_000;
/** 색인 중 이 묶음 수마다 캐시를 쓴다 — 도중에 서버가 죽어도 한 일이 남는다. */
const SAVE_EVERY_BATCHES = 25;

export type EmbedState = 'off' | 'no-ollama' | 'no-model' | 'idle' | 'building' | 'ready';
export type EmbedStatus = {
  state: EmbedState;
  model: string | null;
  /** 지금 유효한 벡터가 있는 문서 수(색인 중이면 진행). */
  done: number;
  /** 색인 범위 문서 수. */
  total: number;
  /** 이번(또는 지난) 색인에서 건너뛴 문서 수. */
  failed: number;
  /** 마지막 군집 시각(ISO). */
  builtAt: string | null;
  /** 군집 수. 준비 전이면 0. */
  clusters: number;
  /** 사람이 읽는 안내(모델 없음이면 받는 명령). */
  hint?: string;
};

/** 루프백 주소만 받는다. 본문이 이 머신 밖으로 나가면 안 된다(설계서 § 안티 목표). 정규화한 origin 을 돌려준다. */
export function assertLoopbackUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`Ollama 주소가 올바르지 않다: ${raw}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`Ollama 주소는 http(s) 여야 한다: ${raw}`);
  if (u.username !== '' || u.password !== '') throw new Error('Ollama 주소에 계정을 넣지 않는다');
  const host = u.hostname;
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') {
    throw new Error(`Ollama 주소는 127.0.0.1·localhost 여야 한다(본문이 밖으로 나가면 안 된다): ${raw}`);
  }
  return u.origin;
}

/** 볼트 절대경로의 sha1 앞 12자. 캐시 폴더 이름이다 — 파일 안에는 절대경로를 적지 않는다. */
export function vaultHash(root: string): string {
  let abs = path.resolve(root);
  try {
    abs = fs.realpathSync(abs);
  } catch {
    // 없는 경로면 resolve 값 그대로.
  }
  return createHash('sha1').update(abs).digest('hex').slice(0, 12);
}

/** `~/.knowledge-viewer/<vault-hash>`. 볼트 밖이다 — 볼트에 생성 캐시를 두지 않는다. */
export function defaultCacheDir(root: string, home: string = os.homedir()): string {
  return path.join(home, '.knowledge-viewer', vaultHash(root));
}

/**
 * 벡터화할 글. EmbeddingGemma 2 의 군집용 프롬프트(`task: clustering | query: …` — 대칭 작업이라 모든 문서에 같은 꼴)에
 * 제목과 본문 앞부분(frontmatter 제외)을 싣는다.
 */
export function embedInput(title: string, body: string): string {
  return `task: clustering | query: ${title}\n\n${body.slice(0, EMBED_CHARS)}`;
}

export const sha1 = (s: string): string => createHash('sha1').update(s).digest('hex');

/** 캐시 항목. vec 는 Float32 리틀엔디안 base64 다(숫자 배열보다 절반 크기). hash 는 벡터화한 글의 sha1 이다. */
export type CacheItem = { path: string; hash: string; model: string; dim: number; vec: string };
export type CacheFile = { schema: number; model: string; builtAt: string | null; items: CacheItem[] };

export const encodeVec = (v: ArrayLike<number>): string => Buffer.from(Float32Array.from(v).buffer).toString('base64');
export function decodeVec(s: string, dim: number): Float32Array | null {
  const buf = Buffer.from(s, 'base64');
  if (buf.length !== dim * 4) return null;
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i += 1) out[i] = buf.readFloatLE(i * 4);
  return out;
}

/** 캐시를 읽는다. 없거나 깨졌거나 형식이 다르면 null. */
export function readCacheFile(file: string): CacheFile | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<CacheFile>;
    if (raw.schema !== CACHE_SCHEMA || !Array.isArray(raw.items) || typeof raw.model !== 'string') return null;
    return { schema: raw.schema, model: raw.model, builtAt: typeof raw.builtAt === 'string' ? raw.builtAt : null, items: raw.items };
  } catch {
    return null;
  }
}

/** 임시 파일에 쓰고 바꿔 끼운다 — 쓰다 죽어도 옛 캐시가 남는다. */
export function writeCacheFile(file: string, data: CacheFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export type EmbeddingOptions = {
  root: string;
  index: Pick<VaultIndex, 'files' | 'title' | 'body' | 'degree'>;
  ollamaUrl?: string;
  model?: string;
  /** 캐시 폴더. 기본 `~/.knowledge-viewer/<vault-hash>`. 시험이 임시 폴더를 준다. */
  cacheDir?: string;
  fetch?: FetchLike;
  concurrency?: number;
  log?: (line: string) => void;
};

type Vector = { hash: string; vec: Float32Array };
type Probe = { ok: true } | { ok: false; state: 'no-ollama' | 'no-model'; hint: string };

/** Ollama 의 모델 이름이 고른 모델인가. 태그를 안 적었으면 `:latest` 도 같다. */
export function modelMatches(name: string, want: string): boolean {
  if (name === want) return true;
  return !want.includes(':') && name === `${want}:latest`;
}

export class EmbeddingService {
  readonly model: string;
  readonly cacheFile: string;
  private readonly index: EmbeddingOptions['index'];
  private readonly url: string;
  private readonly fetch: FetchLike;
  private readonly concurrency: number;
  private readonly log: (line: string) => void;
  private loaded = false;
  private vectors = new Map<string, Vector>();
  private dim = 0;
  private clusterMap: Map<string, string> | null = null;
  private clusterCount = 0;
  private builtAt: string | null = null;
  private failed = 0;
  private progress: { done: number; total: number } | null = null;
  private running: Promise<void> | null = null;

  constructor(opts: EmbeddingOptions) {
    this.url = assertLoopbackUrl(opts.ollamaUrl ?? DEFAULT_OLLAMA_URL);
    this.model = opts.model ?? DEFAULT_EMBED_MODEL;
    this.index = opts.index;
    this.cacheFile = path.join(opts.cacheDir ?? defaultCacheDir(opts.root), 'embeddings.json');
    this.fetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.concurrency = Math.max(1, opts.concurrency ?? EMBED_CONCURRENCY);
    this.log = opts.log ?? ((line) => console.log(line));
  }

  /** 색인 범위 문서(경로순). 지도 범위와 같다 — private·raw·archive·제외 폴더는 빠진다. */
  scopeDocs(): string[] {
    return [...this.index.files].filter((p) => p.endsWith('.md') && inGraphScope(p) && !EXCLUDED_TOP.includes(p.split('/')[0] ?? '')).sort();
  }

  private inputOf(p: string): string {
    return embedInput(this.index.title(p), this.index.body(p));
  }

  /** 문서 → 지금 벡터화할 글의 해시. */
  private hashes(docs: readonly string[]): Map<string, string> {
    return new Map(docs.map((p) => [p, sha1(this.inputOf(p))]));
  }

  /** 첫 상태 조회에 캐시를 읽는다. 모델이 같은 항목만 쓰고, 지금 본문과 해시가 맞는 것이 둘 이상이면 바로 군집한다. */
  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const cache = readCacheFile(this.cacheFile);
    if (cache === null) return;
    for (const it of cache.items) {
      if (it.model !== this.model || typeof it.path !== 'string' || typeof it.hash !== 'string' || !Number.isInteger(it.dim)) continue;
      const vec = decodeVec(it.vec, it.dim);
      if (vec === null || (this.dim !== 0 && it.dim !== this.dim)) continue;
      this.dim = it.dim;
      this.vectors.set(it.path, { hash: it.hash, vec });
    }
    if (this.vectors.size > 0) {
      this.cluster(this.scopeDocs());
      if (this.clusterMap !== null) this.builtAt = cache.builtAt;
    }
  }

  /** 지금 본문과 해시가 맞는 벡터가 있는 문서. */
  private validDocs(docs: readonly string[], hashes: ReadonlyMap<string, string>): string[] {
    return docs.filter((p) => this.vectors.get(p)?.hash === hashes.get(p));
  }

  /** Ollama 가 떠 있고 모델이 있는가. 모델을 받지 않는다(자동 pull 금지) — 받는 명령을 안내만 한다. */
  async probe(): Promise<Probe> {
    let res;
    try {
      res = await this.fetch(`${this.url}/api/tags`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    } catch {
      return { ok: false, state: 'no-ollama', hint: 'Ollama 가 꺼져 있다 — ollama serve 로 켠다' };
    }
    if (!res.ok) return { ok: false, state: 'no-ollama', hint: `Ollama 가 HTTP ${res.status} 로 답했다` };
    const body = (await res.json().catch(() => null)) as { models?: { name?: unknown; model?: unknown }[] } | null;
    const names = (body?.models ?? []).flatMap((m) => [m.name, m.model]).filter((s): s is string => typeof s === 'string');
    if (!names.some((n) => modelMatches(n, this.model))) {
      return { ok: false, state: 'no-model', hint: `ollama pull ${this.model}` };
    }
    return { ok: true };
  }

  async status(): Promise<EmbedStatus> {
    this.ensureLoaded();
    const base = { model: this.model, failed: this.failed, builtAt: this.builtAt, clusters: this.clusterCount };
    if (this.progress !== null) return { ...base, state: 'building', done: this.progress.done, total: this.progress.total };
    const docs = this.scopeDocs();
    const done = this.validDocs(docs, this.hashes(docs)).length;
    if (this.clusterMap !== null) return { ...base, state: 'ready', done, total: docs.length };
    const p = await this.probe();
    if (!p.ok) return { ...base, state: p.state, done, total: docs.length, hint: p.hint };
    return { ...base, state: 'idle', done, total: docs.length };
  }

  /** 색인을 시작한다(뒤에서 돈다). 이미 돌고 있으면 진행률만, Ollama·모델이 없으면 그 상태를 돌려준다. */
  async build(): Promise<EmbedStatus> {
    this.ensureLoaded();
    if (this.running !== null) return this.status();
    const p = await this.probe();
    if (!p.ok) {
      // 군집이 이미 있으면 ready 를 지킨다(화면이 메타로 떨어지지 않게) — 색인을 못 한 까닭만 hint 로 싣는다.
      const st = await this.status();
      return st.state === 'ready' ? { ...st, hint: p.hint } : st;
    }
    if (this.running !== null) return this.status();
    this.running = this.run().finally(() => {
      this.running = null;
      this.progress = null;
    });
    return this.status();
  }

  /** 색인이 끝날 때까지 기다린다(시험·종료용). */
  async whenIdle(): Promise<void> {
    await this.running;
  }

  /** 문서 → 군집 이름(`#3 · 제목`). 준비 전이면 null. */
  clusters(): ReadonlyMap<string, string> | null {
    this.ensureLoaded();
    return this.clusterMap;
  }

  private async run(): Promise<void> {
    const t0 = performance.now();
    const docs = this.scopeDocs();
    const inputs = new Map(docs.map((p) => [p, this.inputOf(p)]));
    const hashes = new Map([...inputs].map(([p, s]) => [p, sha1(s)]));
    const todo = docs.filter((p) => this.vectors.get(p)?.hash !== hashes.get(p));
    this.failed = 0;
    this.progress = { done: docs.length - todo.length, total: docs.length };
    const batches: string[][] = [];
    for (let i = 0; i < todo.length; i += EMBED_BATCH) batches.push(todo.slice(i, i + EMBED_BATCH));
    let next = 0;
    let sinceSave = 0;
    const worker = async (): Promise<void> => {
      while (next < batches.length) {
        const batch = batches[next++]!;
        const got = await this.embedBatch(batch.map((p) => inputs.get(p)!));
        for (let i = 0; i < batch.length; i += 1) {
          const v = got[i];
          if (v === undefined || v === null) {
            this.failed += 1;
            continue;
          }
          this.vectors.set(batch[i]!, { hash: hashes.get(batch[i]!)!, vec: v });
          this.progress!.done += 1;
        }
        sinceSave += 1;
        if (sinceSave >= SAVE_EVERY_BATCHES) {
          sinceSave = 0;
          this.save(docs);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, Math.max(1, batches.length)) }, worker));
    // 범위를 떠난 문서의 벡터는 버린다.
    const keep = new Set(docs);
    for (const p of [...this.vectors.keys()]) if (!keep.has(p)) this.vectors.delete(p);
    const tk = performance.now();
    this.cluster(docs);
    this.builtAt = new Date().toISOString();
    this.save(docs);
    this.log(
      `임베딩 ${this.model}: ${docs.length} 문서 · 새로 ${todo.length - this.failed} · 실패 ${this.failed} · 군집 ${this.clusterCount} · ` +
        `${((tk - t0) / 1000).toFixed(1)}s + 군집 ${((performance.now() - tk) / 1000).toFixed(1)}s`,
    );
  }

  /** 한 묶음을 벡터화한다. 묶음 요청이 실패하면 한 문서씩 다시 — 끝내 실패한 문서는 null(건너뛴다). */
  private async embedBatch(texts: string[]): Promise<(Float32Array | null)[]> {
    const many = await this.embed(texts);
    if (many !== null) return many;
    if (texts.length === 1) return [null];
    const out: (Float32Array | null)[] = [];
    for (const t of texts) out.push((await this.embed([t]))?.[0] ?? null);
    return out;
  }

  private async embed(texts: string[]): Promise<Float32Array[] | null> {
    try {
      const res = await this.fetch(`${this.url}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: texts, truncate: true }),
        signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { embeddings?: unknown };
      const list = body.embeddings;
      if (!Array.isArray(list) || list.length !== texts.length) return null;
      const out: Float32Array[] = [];
      for (const v of list) {
        if (!Array.isArray(v) || v.length === 0 || v.some((x) => typeof x !== 'number' || !Number.isFinite(x))) return null;
        if (this.dim !== 0 && v.length !== this.dim) return null;
        this.dim = v.length;
        out.push(Float32Array.from(v as number[]));
      }
      return out;
    } catch {
      return null;
    }
  }

  /** 유효한 벡터로 k-means 를 돌려 군집 이름을 매긴다. 둘 미만이면 준비 안 됨. */
  private cluster(docs: readonly string[]): void {
    const valid = this.validDocs(docs, this.hashes(docs));
    if (valid.length < 2) {
      this.clusterMap = null;
      this.clusterCount = 0;
      return;
    }
    const { k, assign } = kmeans(
      valid.map((p) => this.vectors.get(p)!.vec),
      kFor(valid.length),
    );
    this.clusterMap = nameClusters(valid, assign, k, (p) => {
      const d = this.index.degree(p);
      return d.in + d.out;
    }, (p) => this.index.title(p));
    this.clusterCount = new Set(this.clusterMap.values()).size;
  }

  private save(docs: readonly string[]): void {
    const keep = new Set(docs);
    const items: CacheItem[] = [];
    for (const [p, v] of [...this.vectors].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (!keep.has(p)) continue;
      items.push({ path: p, hash: v.hash, model: this.model, dim: v.vec.length, vec: encodeVec(v.vec) });
    }
    try {
      writeCacheFile(this.cacheFile, { schema: CACHE_SCHEMA, model: this.model, builtAt: this.builtAt, items });
    } catch (e) {
      this.log(`임베딩 캐시를 쓰지 못했다: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/**
 * 군집 번호를 이름으로. 큰 군집부터 #1, #2 …(크기가 같으면 가장 앞 경로순), 이름은 그 군집에서 연결 수가 가장 많은 문서의 제목
 * (같으면 경로순). 결과는 문서 → `#n · 제목`.
 */
export function nameClusters(
  paths: readonly string[],
  assign: readonly number[],
  k: number,
  degreeOf: (p: string) => number,
  titleOf: (p: string) => string,
): Map<string, string> {
  const groups: string[][] = Array.from({ length: k }, () => []);
  paths.forEach((p, i) => groups[assign[i]!]!.push(p));
  const ordered = groups
    .filter((g) => g.length > 0)
    .map((g) => [...g].sort())
    .sort((a, b) => b.length - a.length || (a[0]! < b[0]! ? -1 : 1));
  const out = new Map<string, string>();
  ordered.forEach((g, i) => {
    let top = g[0]!;
    for (const p of g) if (degreeOf(p) > degreeOf(top)) top = p;
    const name = `#${i + 1} · ${titleOf(top)}`;
    for (const p of g) out.set(p, name);
  });
  return out;
}
