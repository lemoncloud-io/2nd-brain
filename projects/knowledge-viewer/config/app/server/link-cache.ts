// 링크 그래프 캐시(docs/link-graph.yml). 읽기·직렬화·대조를 맡는다. 쓰는 것은 CLI(link-cache.ts)뿐이다.
// 계약: docs/superpowers/specs/2026-10-23-knowledge-viewer-link-cache-design.md § 스키마 3,
// 형식: docs/superpowers/specs/2026-10-24-vault-graph-index-design.md § 링크 캐시
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import type { LinkKind } from './link-forms.ts';

export type { LinkKind };
export const SCHEMA = 3;
export const CACHE_PATH = 'docs/link-graph.yml';
export const RESOLVER = 'knowledge-viewer VaultIndex — vault_orphans.py 규칙 + aliases 해석, docmap 포함 간선 없음';
/** 노드 해시는 sha1 앞 16 hex(64 비트)다. 바뀌었는지만 가르면 되고, 문서 수천 개에서 우연히 겹칠 확률은 무시할 만하다. */
export const HASH_LEN = 16;

/**
 * 해석된 링크 묶음 — 같은 (to, kind, 꼴) 링크는 하나로 합치고 수(count)만 센다. 줄 번호는 적지 않는다(뷰어가 쓰지 않는다).
 * stem·target 은 복원할 때 해석기에 넘길 대상을 경로에서 다시 만드는 규칙이다(server/link-forms.ts).
 */
export type CachedLink = { kind: LinkKind; to: string; stem: boolean; target: string | null; count: number };
/** 해석되지 않은 링크. 어디가 깨졌는지 보이도록 줄과 원문 대상을 적는다. */
export type CachedBroken = { kind: LinkKind; line: number; target: string };
export type CachedDoc = { path: string; hash: string; title: string; aliases: string[]; links: CachedLink[]; broken: CachedBroken[] };
export type LinkCache = {
  schema: number;
  parser: string;
  generated: string;
  resolver: string;
  /** 문서(노드) 수. */
  files: number;
  /** 링크 수 — 합친 것을 다시 센 수 + 깨진 링크. */
  links: number;
  /** 엣지 묶음 수. */
  pairs: number;
  /** 깨진 링크 수. */
  unresolved: number;
  docs: CachedDoc[];
};

/** 조인 키 — sha1(NFC(볼트 상대경로)) 앞 12자. 파일에는 적지 않고 경로에서 계산한다. raw 색인(docs/raw-index.yml)과 같은 규칙이다. */
export function nodeKey(p: string): string {
  return sha1(p.normalize('NFC')).slice(0, 12);
}

export function sha1(bytes: Buffer | string): string {
  return crypto.createHash('sha1').update(bytes).digest('hex');
}

/** 추출기 지문 — 링크·frontmatter·제목을 뽑는 소스, 링크 꼴(대상을 경로에서 다시 만드는 규칙), 파서 의존성의 설치 버전. 바뀌면 캐시 전체를 버린다. */
const PARSER_SOURCES = ['../shared/links.ts', '../shared/markdown.ts', '../shared/frontmatter.ts', '../shared/wikitarget.ts', './link-forms.ts', './index-store.ts'];
/** 마크다운·frontmatter 를 실제로 토큰화하는 패키지 계열. react·mermaid 등 렌더 의존성은 결과에 영향이 없어 뺀다. */
const PARSER_PACKAGE = /^(micromark|mdast-util-|remark-gfm$|unist-util-|yaml$)/;

/** 잠금 파일(package-lock.json `packages`)에서 파서 계열 패키지의 `이름@버전` 을 정렬해 낸다. 중첩 설치도 이름으로 본다. */
export function parserDependencyVersions(lock: unknown): string[] {
  const packages = (lock as { packages?: Record<string, { version?: unknown }> } | null)?.packages ?? {};
  const out = new Set<string>();
  for (const [key, meta] of Object.entries(packages)) {
    const i = key.lastIndexOf('node_modules/');
    if (i === -1) continue;
    const name = key.slice(i + 'node_modules/'.length);
    if (!PARSER_PACKAGE.test(name) || typeof meta?.version !== 'string') continue;
    out.add(`${name}@${meta.version}`);
  }
  return [...out].sort();
}

let fingerprint: string | null = null;
export function parserFingerprint(): string {
  if (fingerprint !== null) return fingerprint;
  const h = crypto.createHash('sha1');
  for (const rel of PARSER_SOURCES) h.update(fs.readFileSync(path.join(import.meta.dirname, rel)));
  const lockFile = path.join(import.meta.dirname, '..', 'package-lock.json');
  let versions: string[];
  if (fs.existsSync(lockFile)) versions = parserDependencyVersions(JSON.parse(fs.readFileSync(lockFile, 'utf8')));
  else {
    // 잠금 파일이 없으면 package.json 의 범위라도 본다 — 설치 버전은 모른다.
    const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    versions = Object.entries(pkg.dependencies ?? {}).filter(([n]) => PARSER_PACKAGE.test(n)).map(([n, v]) => `${n}@${v}`).sort();
  }
  h.update(versions.join('\n'));
  fingerprint = h.digest('hex');
  return fingerprint;
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isRow = (v: unknown, n: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < n;

export type ReadResult = { status: 'ok'; cache: LinkCache } | { status: 'absent' | 'unreadable'; cache: null };

/** 캐시 경로. 절대 경로는 그대로, 상대 경로는 볼트 루트 기준이다. */
export function cacheFile(root: string, cachePath: string = CACHE_PATH): string {
  return path.resolve(root, cachePath);
}

/**
 * 캐시 파일을 읽는다. 없으면 absent, 있는데 YAML이 깨졌거나 모양이 다르면 unreadable(충돌 표식이 남은 파일 등) —
 * 둘 다 캐시 없이 가지만, 읽지 못한 쪽은 사람이 알아야 한다.
 */
export function readCacheResult(root: string, cachePath: string = CACHE_PATH): ReadResult {
  const parsed = parseCacheFile(cacheFile(root, cachePath));
  if (parsed === 'absent') return { status: 'absent', cache: null };
  if (parsed === null) return { status: 'unreadable', cache: null };
  return { status: 'ok', cache: parsed };
}

/** 캐시 파일을 읽는다. 없거나 YAML이 깨졌거나 모양이 다르면 null — 호출자는 캐시 없이 간다. */
export function readCache(root: string, cachePath: string = CACHE_PATH): LinkCache | null {
  return readCacheResult(root, cachePath).cache;
}

function withHeader(o: Record<string, unknown>, docs: CachedDoc[]): LinkCache {
  let links = 0;
  let pairs = 0;
  let unresolved = 0;
  for (const d of docs) {
    for (const l of d.links) links += l.count;
    pairs += d.links.length;
    unresolved += d.broken.length;
  }
  return {
    schema: o.schema as number,
    parser: isStr(o.parser) ? o.parser : '',
    generated: isStr(o.generated) ? o.generated : '',
    resolver: isStr(o.resolver) ? o.resolver : '',
    files: docs.length,
    links: links + unresolved,
    pairs,
    unresolved,
    docs,
  };
}

function parseCacheFile(file: string): LinkCache | null | 'absent' {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return 'absent';
  }
  let raw: unknown = parseLines(text);
  if (raw === null) {
    try {
      raw = parseYaml(text);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.schema !== 'number') return null;
  // 다른 스키마(1·2 포함)는 머리만 읽는다 — 쓸 수 없는 캐시(isUsable false)로 돌아가 전부 파싱하고, verify 는 schema 불일치로 2 다.
  if (o.schema !== SCHEMA) return withHeader(o, []);
  return fromGraph(o);
}

const SECTIONS = ['nodes', 'edges', 'broken'] as const;
type Section = (typeof SECTIONS)[number];
const HEAD_LINE = /^([a-z]+): (.*)$/;

/**
 * 빠른 길 — serialize 가 쓴 꼴(머리 `키: JSON`, 절마다 `- [JSON 배열]` 한 줄)을 줄마다 JSON.parse 로 읽는다.
 * 그 밖의 줄이 하나라도 있으면(손으로 고친 파일, 충돌 표식, 다른 스키마) null — 호출자가 yaml 패키지로 읽는다.
 */
function parseLines(text: string): Record<string, unknown> | null {
  const o: Record<string, unknown> = {};
  const lists: Record<Section, unknown[]> = { nodes: [], edges: [], broken: [] };
  let section: Section | null = null;
  try {
    for (const line of text.split('\n')) {
      if (line === '' || line.startsWith('#')) continue;
      if (section !== null && line.startsWith('- [')) {
        lists[section].push(JSON.parse(line.slice(2)));
        continue;
      }
      const name = SECTIONS.find((s) => line === `${s}:` || line === `${s}: []`);
      if (name !== undefined) {
        section = name;
        continue;
      }
      const h = section === null ? HEAD_LINE.exec(line) : null;
      if (!h || (SECTIONS as readonly string[]).includes(h[1] as string)) return null;
      o[h[1] as string] = JSON.parse(h[2] as string);
    }
  } catch {
    return null;
  }
  if (o.schema !== SCHEMA || section === null) return null;
  return { ...o, ...lists };
}

/** 엣지 한 칸: 행 번호, 또는 [행, 꼴, 수?, 원문 대상?]. 꼴은 kind 한 글자(`m` md·`e` embed, 없으면 wiki) + 파일명 꼴이면 `s`. */
function toLink(v: unknown, docs: readonly CachedDoc[]): CachedLink | null {
  if (isRow(v, docs.length)) return { kind: 'wiki', to: (docs[v] as CachedDoc).path, stem: false, target: null, count: 1 };
  if (!Array.isArray(v) || v.length < 2 || v.length > 4) return null;
  const [row, flags, count = 1, target] = v as unknown[];
  if (!isRow(row, docs.length) || !isStr(flags) || !/^[me]?s?$/.test(flags) || flags === 'ms') return null;
  if (!Number.isInteger(count) || (count as number) < 1 || !(target === undefined || isStr(target))) return null;
  const stem = flags.endsWith('s');
  if (stem && target !== undefined) return null;
  const kind: LinkKind = flags.startsWith('m') ? 'md' : flags.startsWith('e') ? 'embed' : 'wiki';
  return { kind, to: (docs[row] as CachedDoc).path, stem, target: target ?? null, count: count as number };
}

/** nodes·edges·broken 을 문서 목록으로 되돌린다. 모양이 하나라도 다르면 null. */
function fromGraph(o: Record<string, unknown>): LinkCache | null {
  const { nodes, edges } = o;
  const broken = o.broken ?? [];
  if (!Array.isArray(nodes) || !Array.isArray(edges) || !Array.isArray(broken)) return null;
  const docs: CachedDoc[] = [];
  for (const n of nodes) {
    if (!Array.isArray(n) || n.length < 3 || n.length > 4) return null;
    const [p, h, t, a = []] = n as unknown[];
    if (!isStr(p) || !isStr(h) || !isStr(t) || !Array.isArray(a) || !a.every(isStr)) return null;
    docs.push({ path: p, hash: h, title: t, aliases: [...a], links: [], broken: [] });
  }
  const seen = new Set<number>();
  for (const e of edges) {
    if (!Array.isArray(e) || e.length < 2 || !isRow(e[0], docs.length) || seen.has(e[0])) return null;
    seen.add(e[0]);
    const doc = docs[e[0]] as CachedDoc;
    for (const v of e.slice(1)) {
      const link = toLink(v, docs);
      if (!link) return null;
      doc.links.push(link);
    }
  }
  for (const b of broken) {
    if (!Array.isArray(b) || b.length < 3 || b.length > 4) return null;
    const [row, line, target, flag] = b as unknown[];
    if (!isRow(row, docs.length) || !Number.isInteger(line) || !isStr(target)) return null;
    if (!(flag === undefined || flag === 'm' || flag === 'e')) return null;
    (docs[row] as CachedDoc).broken.push({ kind: flag === 'm' ? 'md' : flag === 'e' ? 'embed' : 'wiki', line: line as number, target });
  }
  return withHeader(o, docs.sort(byPath));
}

/** 스키마와 추출기 지문이 지금 코드와 같을 때만 쓴다. */
export function isUsable(cache: LinkCache | null): cache is LinkCache {
  return cache !== null && cache.schema === SCHEMA && cache.parser === parserFingerprint();
}

// 스칼라는 JSON 따옴표로 쓴다 — YAML 1.2의 부분집합이라 yaml 패키지가 그대로 읽는다. 목록 한 줄은 빈칸 없는 JSON 배열이다.
const q = (s: string): string => JSON.stringify(s);

const byPath = (a: CachedDoc, b: CachedDoc): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

const KIND_FLAG: Record<LinkKind, string> = { wiki: '', md: 'm', embed: 'e' };

function linkCell(l: CachedLink, row: number): string {
  const flags = KIND_FLAG[l.kind] + (l.stem ? 's' : '');
  if (l.target !== null) return `[${row},${q(flags)},${l.count},${q(l.target)}]`;
  if (l.count > 1) return `[${row},${q(flags)},${l.count}]`;
  return flags === '' ? String(row) : `[${row},${q(flags)}]`;
}

/**
 * 결정적 출력. 노드는 경로순이고 엣지·깨진 링크는 노드의 행 번호(0 부터)로 가리킨다 — 경로는 nodes 에 한 번만 나온다.
 * 엣지는 보내는 문서마다 한 줄이라 한 문서의 링크가 바뀌면 그 줄만 바뀐다(문서가 늘거나 줄면 뒤 행 번호가 밀린다).
 */
export function serialize(cache: LinkCache): string {
  const docs = [...cache.docs].sort(byPath);
  const row = new Map<string, number>();
  const owner = new Map<string, string>();
  for (const [i, d] of docs.entries()) {
    row.set(d.path, i);
    // 조인 키는 적지 않지만 두 경로가 같은 키를 가지면 raw 색인과 조인이 섞인다 — 쓰지 않는다.
    const k = nodeKey(d.path);
    const prev = owner.get(k);
    if (prev !== undefined) throw new Error(`노드 키가 겹친다: ${k} — ${prev} · ${d.path}`);
    owner.set(k, d.path);
  }
  const rowOf = (p: string): number => {
    const r = row.get(p);
    if (r === undefined) throw new Error(`문서 목록에 없는 대상이다: ${p}`);
    return r;
  };
  const counted = withHeader({ schema: cache.schema }, docs);
  const out: string[] = [
    '# Link Graph — 볼트 문서 연결 관계 캐시. 자동 생성, 수동 편집 금지.',
    '# 재생성: node projects/knowledge-viewer/config/app/link-cache.ts build (lint 레인만 커밋)',
    '# 계약: docs/superpowers/specs/2026-10-23-knowledge-viewer-link-cache-design.md § 스키마 3',
    '# nodes: [경로, sha1 앞 16자, 제목, 별칭?]. edges: [보내는 행, 받는 행 | [받는 행, 꼴, 수?, 원문?] …]. broken: [행, 줄, 원문, 꼴?]',
    `schema: ${cache.schema}`,
    `parser: ${q(cache.parser)}`,
    `generated: ${q(cache.generated)}`,
    `resolver: ${q(cache.resolver)}`,
    `files: ${counted.files}`,
    `links: ${counted.links}`,
    `pairs: ${counted.pairs}`,
    `unresolved: ${counted.unresolved}`,
    'nodes:' + (docs.length === 0 ? ' []' : ''),
  ];
  for (const d of docs) {
    const a = d.aliases.length > 0 ? `,[${d.aliases.map(q).join(',')}]` : '';
    out.push(`- [${q(d.path)},${q(d.hash)},${q(d.title)}${a}]`);
  }
  const edges: string[] = [];
  const broken: string[] = [];
  for (const [i, d] of docs.entries()) {
    if (d.links.length > 0) edges.push(`- [${i},${d.links.map((l) => linkCell(l, rowOf(l.to))).join(',')}]`);
    for (const b of d.broken) broken.push(`- [${i},${b.line},${q(b.target)}${b.kind === 'wiki' ? '' : ',' + q(KIND_FLAG[b.kind])}]`);
  }
  out.push('edges:' + (edges.length === 0 ? ' []' : ''), ...edges);
  out.push('broken:' + (broken.length === 0 ? ' []' : ''), ...broken);
  return out.join('\n') + '\n';
}

export type CacheDiff = { schema: boolean; parser: boolean; missing: string[]; gone: string[]; stale: string[]; drift: string[] };

const sameLinks = (a: CachedLink[], b: CachedLink[]): boolean =>
  a.length === b.length && a.every((l, i) => {
    const m = b[i];
    return m !== undefined && l.kind === m.kind && l.to === m.to && l.stem === m.stem && l.target === m.target && l.count === m.count;
  });

const sameBroken = (a: CachedBroken[], b: CachedBroken[]): boolean =>
  a.length === b.length && a.every((x, i) => {
    const m = b[i];
    return m !== undefined && x.kind === m.kind && x.line === m.line && x.target === m.target;
  });

/**
 * 캐시(old)와 지금 디스크에서 만든 것(fresh)의 차이. generated 는 보지 않는다.
 * missing·gone 은 문서 집합, stale 은 해시, drift 는 해시가 같은데 제목·별칭·링크 해석이 다른 것이다.
 */
export function diffCache(old: LinkCache | null, fresh: LinkCache): CacheDiff {
  const d: CacheDiff = { schema: false, parser: false, missing: [], gone: [], stale: [], drift: [] };
  if (old === null || old.schema !== fresh.schema) {
    d.schema = true;
    return d;
  }
  if (old.parser !== fresh.parser) d.parser = true;
  const oldDocs = new Map(old.docs.map((doc) => [doc.path, doc]));
  for (const doc of fresh.docs) {
    const prev = oldDocs.get(doc.path);
    if (!prev) d.missing.push(doc.path);
    else if (prev.hash !== doc.hash) d.stale.push(doc.path);
    else if (
      prev.title !== doc.title ||
      prev.aliases.join('\0') !== doc.aliases.join('\0') ||
      !sameLinks(prev.links, doc.links) ||
      !sameBroken(prev.broken, doc.broken)
    )
      d.drift.push(doc.path);
    oldDocs.delete(doc.path);
  }
  d.gone = [...oldDocs.keys()].sort();
  return d;
}

export function isClean(d: CacheDiff): boolean {
  return !d.schema && !d.parser && d.missing.length === 0 && d.gone.length === 0 && d.stale.length === 0 && d.drift.length === 0;
}

/** 해석되지 않은 링크. 보고용이다 — 판정은 vault_orphans.py --broken 의 몫. */
export function brokenLinks(cache: LinkCache): { path: string; line: number; target: string }[] {
  const out: { path: string; line: number; target: string }[] = [];
  for (const doc of cache.docs) for (const b of doc.broken) out.push({ path: doc.path, line: b.line, target: b.target });
  return out;
}

/** 캐시를 쓴다. generated 말고 달라지는 것이 없으면 쓰지 않고 false — 날짜만 바뀐 diff 를 만들지 않기 위해서다. */
export function writeCache(root: string, cache: LinkCache, cachePath: string = CACHE_PATH): boolean {
  const file = cacheFile(root, cachePath);
  const text = serialize(cache);
  let old: string | null = null;
  try {
    old = fs.readFileSync(file, 'utf8');
  } catch {
    old = null;
  }
  const strip = (s: string): string => s.replace(/^generated: .*$/m, 'generated: -');
  if (old !== null && strip(old) === strip(text)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return true;
}
