// /api 핸들러: (ctx, url) → Promise<{ status, body }>. 소켓은 main.ts가 만진다.
// `src`(main·local·pr:<n>) 가 없으면 local(디스크)이다. local 은 디스크 경로 그대로, 그 밖은 SourceReader 로 읽는다.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { vaultInfo } from './info.ts';

import { splitFrontmatter, titleOf } from '../shared/frontmatter.ts';
import { embedKind } from '../shared/embeds.ts';
import { resolveImageEmbed } from '../shared/image-src.ts';
import { extractLinks, type LinkRef } from '../shared/links.ts';
import { gitIgnored, isCanonicallyAllowed, listDir, segmentsBlocked } from '../shared/scope.ts';
import { extractHeadings } from '../shared/slug.ts';
import { LOCAL, MAIN, parseSource, sourceKey } from '../shared/source.ts';
import type { Source } from '../shared/source.ts';
import type { Entry, Heading } from '../shared/types.ts';
import { toVaultPath } from '../shared/vault.ts';
import type { VaultIndex } from './index-store.ts';
import { docChange, prChanges, type DocChange } from './changes.ts';
import type { EmbeddingService } from './embeddings.ts';
import { collectEmbeds } from './embeds.ts';
import { handleFile } from './file-view.ts';
import { buildGraph, GraphError } from './graph.ts';
import type { GraphQuery } from './graph.ts';
import { searchIndex } from './search.ts';
import { redactReason, type SourceManager, type SourceReader } from './source.ts';

export type Ctx = {
  root: string;
  includePrivate: boolean;
  index: VaultIndex;
  titleCache: Map<string, { mtime: number; title: string }>;
  sources: SourceManager;
  /** git 소스(@main·@pr) /raw 를 내는 별도 출처의 포트. 모르면 null. */
  gitRawPort?: () => number | null;
  /** 그래프 허브 문턱. `in + out` 이 이 값보다 크면 허브다. */
  graphHub: number;
  /** 임베딩 묶음(로컬 Ollama). 없으면 꺼짐 — /api/info 가 available: false 로 알린다. */
  embeddings?: EmbeddingService;
};

export type ApiResult = { status: number; body: unknown };

const fail = (status: number, error: string): ApiResult => ({ status, body: { error } });

/**
 * 디스크 범위 검사. 볼트 상대 경로이고 `..`·`.` 조각이 없으며, 제외 폴더나
 * (includePrivate가 아닐 때) private를 지나지 않으면 절대경로를 돌려준다. 아니면 null이다.
 * 디렉터리를 걷지 않는다 — 조각을 대소문자 무시로 본 뒤, 이 한 경로의 정식 경로(realpath)를 다시 본다.
 */
export function resolveDiskPath(ctx: Pick<Ctx, 'root' | 'includePrivate'>, rel: string): string | null {
  const segs = rel.split('/');
  if (segmentsBlocked(segs, ctx)) return null;
  let abs: string;
  try {
    abs = toVaultPath(ctx.root, rel);
  } catch {
    return null;
  }
  // 정식 경로(대소문자·심링크를 푼 것)로 다시 검사한다. 없는 파일도 여기서 null이 된다.
  return isCanonicallyAllowed(ctx.root, abs, ctx) ? abs : null;
}

/** 실제 경로(심링크 해소 뒤)가 볼트 안인 일반 파일이면 true다. */
export function isFileInside(root: string, abs: string): boolean {
  try {
    const real = fs.realpathSync(abs);
    const realRoot = fs.realpathSync(root);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return false;
    return fs.statSync(real).isFile();
  } catch {
    return false;
  }
}

function stampOf(root: string, rel: string): { commit: string | null; dirty: boolean } {
  const run = (args: string[]): string | null => {
    const res = spawnSync('git', ['-C', root, ...args, '--', rel], { encoding: 'utf8', timeout: 10_000 });
    if (res.error || res.status !== 0) return null;
    return res.stdout.trim();
  };
  const commit = run(['log', '-1', '--format=%h']);
  const status = run(['status', '--porcelain']);
  return { commit: commit === null || commit === '' ? null : commit, dirty: status !== null && status !== '' };
}

const isErr = (v: unknown): v is ApiResult => typeof v === 'object' && v !== null && 'status' in v && 'body' in v;

/** git 소스는 private 를 담지 않는다 — 경로 검사도 그렇게 한다. */
const GIT_SCOPE = { includePrivate: false };

/** `src` 질의가 git 소스(main·pr)인가. 형식이 틀리면 false — 400 은 readSource 가 낸다. */
function isGitSrc(url: URL): boolean {
  const raw = url.searchParams.get('src');
  if (raw === null) return false;
  const src = parseSource(raw);
  return src !== null && src.kind !== 'local';
}

/** `src` 질의를 소스와 리더로. 없으면 local, 형식이 틀리면 400, 리더를 못 열면 503. */
export async function readSource(ctx: Ctx, url: URL): Promise<{ src: Source; reader: SourceReader } | ApiResult> {
  const raw = url.searchParams.get('src');
  const src = raw === null ? LOCAL : parseSource(raw);
  if (src === null) return fail(400, 'src 가 올바르지 않다');
  const reader = await ctx.sources.reader(src, ctx.includePrivate);
  if ('error' in reader) return fail(503, reader.error);
  return { src, reader };
}

type DocTarget = { src: Source; reader: SourceReader; rel: string; text: string; mtime: number };

/**
 * 문서 경로 질의(`path`)와 소스를 검사해 본문을 읽는다. local 은 디스크 경로 규칙(정식 경로·심링크) 그대로,
 * git 소스는 같은 조각 규칙(`..`·제외 폴더·private)을 먼저 본 뒤 리더로 읽는다(디스크에 없어도 된다).
 */
async function docTarget(ctx: Ctx, url: URL): Promise<DocTarget | ApiResult> {
  const rel = url.searchParams.get('path');
  if (rel === null) return fail(404, 'path가 없다');
  // 조각 규칙은 소스를 열기(fetch·gh) 전에 본다 — 거부할 경로가 네트워크를 부르지 않게.
  // git 소스는 private 를 담지 않으므로 includePrivate 서버에서도 private 를 여기서 거른다.
  if (segmentsBlocked(rel.split('/'), isGitSrc(url) ? GIT_SCOPE : ctx)) return fail(404, `열 수 없는 경로다: ${rel}`);
  const s = await readSource(ctx, url);
  if (isErr(s)) return s;
  const { src, reader } = s;
  if (src.kind !== 'local') {
    if (!rel.endsWith('.md')) return fail(400, `md 문서가 아니다: ${rel}`);
    const text = reader.readText(rel);
    if (text === null) return fail(404, `파일이 없다: ${rel}`);
    return { src, reader, rel, text, mtime: 0 };
  }
  const abs = resolveDiskPath(ctx, rel);
  if (abs === null) return fail(404, `열 수 없는 경로다: ${rel}`);
  if (!rel.endsWith('.md')) return fail(400, `md 문서가 아니다: ${rel}`);
  if (!isFileInside(ctx.root, abs)) return fail(404, `파일이 없다: ${rel}`);
  try {
    const stat = fs.statSync(abs);
    return { src, reader, rel, text: fs.readFileSync(abs, 'utf8'), mtime: stat.mtimeMs };
  } catch {
    return fail(404, `파일을 읽지 못했다: ${rel}`);
  }
}

/** local 은 볼트 색인, 그 밖은 소스 파일 집합(머리 oid 별 캐시)으로 링크를 푼다. */
function resolverOf(ctx: Ctx, src: Source, reader: SourceReader): Pick<VaultIndex, 'resolve'> {
  if (src.kind === 'local') return ctx.index;
  return ctx.sources.resolverFor(reader, (name) => ctx.index.aliasLookup(name));
}

/**
 * 문서 링크 해석에 위키 이미지 임베드(`![[그림.png]]`)를 더한다. 색인은 md 만 알므로 이미지 임베드는 소스의 이미지 목록
 * (같은 리더 — git 소스는 private 를 담지 않는다)에서 파일명으로 찾는다. 목록은 이미지 임베드가 있을 때만 한 번 뜬다.
 * 이미지 아닌 링크·임베드 아닌 `[[그림.png]]` 는 그대로다(앱 안 이동 링크로 그리지 않게).
 */
function withImageEmbeds(base: Pick<VaultIndex, 'resolve'>, reader: SourceReader): (from: string, l: LinkRef) => ReturnType<VaultIndex['resolve']> {
  let images: string[] | undefined;
  return (from, l) => {
    const r = base.resolve(from, l);
    if (r.path !== null || !l.embed || l.kind !== 'wiki' || embedKind(l.target) !== 'image') return r;
    images ??= reader.listImages?.() ?? [];
    const p = resolveImageEmbed(from, l.target, images);
    return p === null ? r : { path: p, candidates: [] };
  };
}

export async function handleTree(ctx: Ctx, url: URL): Promise<ApiResult> {
  const dir = url.searchParams.get('dir') ?? '';
  const segs = dir.split('/').filter((s) => s !== '' && s !== '.');
  const norm = segs.join('/');
  // 조각 규칙은 소스를 열기(fetch·gh) 전에 본다. git 소스는 private 를 담지 않는다.
  if (segs.length > 0 && segmentsBlocked(segs, isGitSrc(url) ? GIT_SCOPE : ctx)) return fail(404, `폴더를 읽지 못했다: ${norm}`);
  const s = await readSource(ctx, url);
  if (isErr(s)) return s;
  const { src, reader } = s;
  let entries: Entry[];
  try {
    entries = src.kind === 'local' ? listDir(ctx.root, dir, { includePrivate: ctx.includePrivate }) : reader.list(dir);
  } catch (e) {
    console.error(`[tree] ${dir}: ${e instanceof Error ? e.message : String(e)}`);
    return fail(404, `폴더를 읽지 못했다: ${norm}`);
  }
  // git 소스: 이 층의 md 제목을 한 번에(blob oid 캐시 + cat-file --batch 한 번) 읽는다.
  const gitTitles = src.kind === 'local' ? null : ctx.sources.titlesFor(reader, entries.filter((e) => e.kind === 'md').map((e) => e.path));
  const out = entries.map((e): Entry & { title?: string } => {
    if (e.kind !== 'md') return e;
    if (gitTitles !== null) {
      const title = gitTitles.get(e.path);
      return title === undefined ? e : { ...e, title };
    }
    const abs = path.join(ctx.root, e.path);
    try {
      const mtime = fs.statSync(abs).mtimeMs;
      const hit = ctx.titleCache.get(e.path);
      if (hit && hit.mtime === mtime) return { ...e, title: hit.title };
      const { data, body } = splitFrontmatter(fs.readFileSync(abs, 'utf8'));
      const title = titleOf(e.path, data, body);
      ctx.titleCache.set(e.path, { mtime, title });
      return { ...e, title };
    } catch {
      return e;
    }
  });
  return { status: 200, body: { dir: norm, entries: out } };
}

export async function handleDoc(ctx: Ctx, url: URL): Promise<ApiResult> {
  const t = await docTarget(ctx, url);
  if (isErr(t)) return t;
  const { src, reader, rel, text, mtime } = t;
  const local = src.kind === 'local';
  const { data, body, bodyStartLine } = splitFrontmatter(text);
  const headings: Heading[] = extractHeadings(body).map((h) => ({ ...h, line: h.line + bodyStartLine - 1 }));
  const resolve = withImageEmbeds(resolverOf(ctx, src, reader), reader);
  const links = extractLinks(text).map((l) => ({ ...l, ...resolve(rel, l) }));
  // 노트 임베드 본문(1단계). 같은 소스 리더로 읽는다 — git 소스는 private 를 담지 않는다.
  const embeds = collectEmbeds({
    rel,
    links,
    bodyStartLine,
    read: (p) => reader.readText(p),
    resolve,
    scope: local ? ctx : GIT_SCOPE,
  });
  const head = reader.head;
  // PR 소스면 이 문서의 변경(hunk)을 붙인다. 변경 목록을 못 뜨면 change 대신 changeError(까닭)를 싣고 문서는 그대로 준다.
  let change: DocChange | undefined;
  let changeError: string | undefined;
  if (src.kind === 'pr') {
    const c = await prChanges(ctx.sources, ctx.root, src.number);
    if ('error' in c) {
      console.error(`[doc] pr:${src.number} 변경 목록: ${c.error}`);
      changeError = redactReason(c.error);
    } else change = docChange(ctx.root, c, rel);
  }
  return {
    status: 200,
    body: {
      source: sourceKey(src),
      head,
      path: rel,
      title: titleOf(rel, data, body),
      frontmatter: data,
      body,
      bodyStartLine,
      frontmatterRaw: text.slice(0, text.length - body.length).replace(/\n$/, ''),
      headings,
      links,
      ...(Object.keys(embeds).length === 0 ? {} : { embeds }),
      backlinks: ctx.index.backlinks(rel),
      stamp: local ? stampOf(ctx.root, rel) : { commit: head, dirty: false },
      mtime,
      ignored: local ? gitIgnored(ctx.root, [rel]).has(rel) : false,
      ...(change === undefined ? {} : { change }),
      ...(changeError === undefined ? {} : { changeError }),
    },
  };
}

export async function handleResolve(ctx: Ctx, url: URL): Promise<ApiResult> {
  const link = url.searchParams.get('link');
  const kind = url.searchParams.get('kind');
  const from = url.searchParams.get('from') ?? '';
  if (link === null || link === '') return fail(400, 'link가 없다');
  if (kind !== 'wiki' && kind !== 'md') return fail(400, 'kind는 wiki 또는 md여야 한다');
  const s = await readSource(ctx, url);
  if (isErr(s)) return s;
  return { status: 200, body: resolverOf(ctx, s.src, s.reader).resolve(from, { kind, target: link }) };
}

const FENCE = /^\s*(`{3,}|~{3,})/;

/** 첫 문단: 빈 줄로 갈리는 덩어리 중 첫 비어 있지 않은 것. 펜스 코드와 `#` 줄은 건너뛰고 `#` 줄에서 끊는다. */
function firstParagraph(text: string): string {
  const para: string[] = [];
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    if (fence !== null) {
      const t = line.trim();
      if (t.length >= fence.length && [...t].every((c) => c === fence![0])) fence = null;
      continue;
    }
    const m = FENCE.exec(line);
    if (m) {
      fence = m[1] ?? null;
      if (para.length > 0) break;
      continue;
    }
    if (line.trim() === '') {
      if (para.length > 0) break;
      continue;
    }
    if (line.startsWith('#')) {
      if (para.length > 0) break;
      continue;
    }
    para.push(line);
  }
  return para.join('\n').trim();
}

const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function handlePreview(ctx: Ctx, url: URL): Promise<ApiResult> {
  const t = await docTarget(ctx, url);
  if (isErr(t)) return t;
  const { rel, text } = t;
  const { data, body } = splitFrontmatter(text);
  let scope = body;
  const anchor = url.searchParams.get('anchor');
  if (anchor !== null && anchor !== '') {
    const headings = extractHeadings(body);
    const i = headings.findIndex((h) => h.slug === anchor);
    const h = headings[i];
    if (h) {
      const lines = body.split('\n');
      const next = headings[i + 1];
      scope = lines.slice(h.line, next ? next.line - 1 : lines.length).join('\n');
    }
  }
  const excerpt = firstParagraph(scope).slice(0, 600);
  return {
    status: 200,
    body: { path: rel, title: titleOf(rel, data, body), type: asString(data.type), status: asString(data.status), excerpt },
  };
}

const SEARCH_LIMIT = 50;

export function handleSearch(ctx: Ctx, url: URL): ApiResult {
  const q = url.searchParams.get('q') ?? '';
  const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'lint';
  if (q.trim() === '') return { status: 200, body: { q, scope, hits: [] } };
  const hits = searchIndex(ctx.index, q, { includeOutside: scope === 'all', root: ctx.root, includePrivate: ctx.includePrivate });
  return { status: 200, body: { q, scope, hits: hits.slice(0, SEARCH_LIMIT) } };
}

/**
 * lint 범위 md 전부의 `{ path, title }`. 화면이 제목 즉시 검색·트리 필터에 쓴다(2,300 건에 약 150 kB).
 * 검색과 같이 디스크 색인 기준이라 `src` 를 받지 않는다. `version` 은 색인 번호다 — SSE 로 바뀐 걸 알면 다시 받는다.
 */
export function handleTitles(ctx: Ctx): ApiResult {
  const items = [...ctx.index.files].sort().map((p) => ({ path: p, title: ctx.index.title(p) }));
  return { status: 200, body: { version: ctx.index.version, items } };
}

/** 지도는 늘 서버의 볼트 색인(작업 트리)으로 짓는다 — `src` 를 받지 않는다. */
export function handleGraph(ctx: Ctx, url: URL): ApiResult {
  const sp = url.searchParams;
  let q: GraphQuery;
  if (sp.get('all') === '1') {
    q = { all: true };
  } else {
    const center = sp.get('center');
    if (center === null || center === '') return fail(400, 'center가 없다');
    const depth = Number(sp.get('depth') ?? 2);
    if (depth !== 1 && depth !== 2 && depth !== 3) return fail(400, 'depth는 1, 2, 3 중 하나여야 한다');
    const hubs = sp.get('hubs') ?? 'keep';
    if (hubs !== 'keep' && hubs !== 'expand') return fail(400, 'hubs는 keep 또는 expand여야 한다');
    // URLSearchParams 가 이미 풀어 준 값이다 — 다시 풀지 않는다.
    const expand = (sp.get('expand') ?? '').split(',').filter((s) => s !== '');
    q = { center, depth, hubs, expand };
  }
  // embed 가 있으면(값은 화면의 캐시 무효화 표지라 보지 않는다) 준비된 임베딩 군집을 노드에 싣는다.
  const embed = sp.get('embed') ? (ctx.embeddings?.clusters() ?? null) : null;
  try {
    return { status: 200, body: buildGraph(ctx.index, q, ctx.graphHub, embed) };
  } catch (e) {
    if (e instanceof GraphError) return fail(404, e.message);
    throw e;
  }
}

/**
 * 지금 볼트 정보와 소스 상태. main 리더를 열어 상태를 채운다 — ref 가 있으면 기다리지 않고(ttl 이 지났으면 뒤에서 fetch),
 * ref 가 없을 때만 fetch 를 기다린다(SourceManager.reader 의 stale-while-revalidate).
 */
async function handleInfo(ctx: Ctx): Promise<ApiResult> {
  await ctx.sources.reader(MAIN, ctx.includePrivate);
  const info = vaultInfo(ctx.root);
  const gitRawPort = ctx.gitRawPort?.() ?? null;
  return {
    status: 200,
    body: {
      ...info,
      ...(gitRawPort === null ? {} : { gitRawPort }),
      embeddings: { available: ctx.embeddings !== undefined, model: ctx.embeddings?.model ?? null },
      sources: { main: ctx.sources.status(MAIN), local: { available: true, head: info.head } },
    },
  };
}

const PR_CHANGES = /^\/api\/pr\/([^/]*)\/changes$/;

/** `GET /api/pr/<n>/changes` — n 은 1~9자리 숫자(아니면 404). 목록을 못 뜨면 503. */
async function handlePrChanges(ctx: Ctx, raw: string): Promise<ApiResult> {
  if (!/^\d{1,9}$/.test(raw)) return fail(404, `PR 번호가 올바르지 않다: ${raw}`);
  const c = await prChanges(ctx.sources, ctx.root, Number(raw));
  if ('error' in c) return fail(503, c.error);
  return { status: 200, body: c };
}

/** 임베딩 색인 시작 경로. 이 경로만 POST 를 받는다(main.ts). */
export const EMBED_BUILD_PATH = '/api/graph/embeddings/build';
const EMBED_OFF = { state: 'off', model: null, done: 0, total: 0, failed: 0, builtAt: null, clusters: 0 };

export async function handleApi(ctx: Ctx, url: URL, method = 'GET'): Promise<ApiResult> {
  const pr = PR_CHANGES.exec(url.pathname);
  if (pr !== null) return handlePrChanges(ctx, pr[1]!);
  if (url.pathname === EMBED_BUILD_PATH) {
    if (method !== 'POST') return fail(405, 'POST만 받는다');
    return { status: 200, body: ctx.embeddings === undefined ? EMBED_OFF : await ctx.embeddings.build() };
  }
  switch (url.pathname) {
    case '/api/graph/embeddings/status':
      return { status: 200, body: ctx.embeddings === undefined ? EMBED_OFF : await ctx.embeddings.status() };
    case '/api/tree':
      return handleTree(ctx, url);
    case '/api/doc':
      return handleDoc(ctx, url);
    case '/api/file':
      return handleFile(ctx, url);
    case '/api/resolve':
      return handleResolve(ctx, url);
    case '/api/preview':
      return handlePreview(ctx, url);
    case '/api/search':
      return handleSearch(ctx, url);
    case '/api/titles':
      return handleTitles(ctx);
    case '/api/graph':
      return handleGraph(ctx, url);
    case '/api/info':
      return handleInfo(ctx);
    default:
      return fail(404, `알 수 없는 API다: ${url.pathname}`);
  }
}
