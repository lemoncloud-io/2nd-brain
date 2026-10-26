// 볼트 색인. lint 범위의 md를 읽어 링크 해석표·역링크·제목을 메모리에 둔다.
// 해석 규칙은 vault_orphans.py(second-brain)의 Vault.resolve와 같다. alias 해석만 뷰어에 더해졌다.
import fs from 'node:fs';
import path from 'node:path';

import { aliasesOf, splitFrontmatter, titleOf } from '../shared/frontmatter.ts';
import { clusterKeyOf, kindOf, topicsOf } from '../shared/kind.ts';
import type { Kind } from '../shared/kind.ts';
import { extractLinks } from '../shared/links.ts';
import type { LinkRef } from '../shared/links.ts';
import { EXCLUDED_DIRS, EXCLUDED_TOP, walkLint } from '../shared/scope.ts';
import { HASH_LEN, RESOLVER, SCHEMA, parserFingerprint, sha1 } from './link-cache.ts';
import type { CachedBroken, CachedDoc, CachedLink, LinkCache } from './link-cache.ts';
import { formOf, neverResolves, targetOf } from './link-forms.ts';

export type BuildStats = { files: number; cached: number; parsed: number; ms: number };
export type BuildOptions = { cache?: LinkCache; strict?: boolean };

export type Resolution = { path: string | null; candidates: string[] };
/** 이 문서를 가리키는 문서 하나. count 는 그 문서 안의 링크 수다(같은 문서로 여러 번 걸면 하나로 묶는다). */
export type Backlink = { path: string; title: string; count: number };

type Record_ = {
  /** 파일 바이트의 sha1. 캐시 항목과 맞춰 본다. */
  hash: string;
  title: string;
  aliases: string[];
  /** 문서 종류(frontmatter `type` 과 경로로 판정). */
  kind: Kind;
  topics: string[];
  body: string;
  links: LinkRef[];
  /** 해석된 간선의 대상(자기 자신 제외). 링크 하나당 하나다. */
  edges: string[];
};

const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const slashes = (p: string): number => p.split('/').length - 1;

export type Lookup = { byBase: Map<string, string[]>; bySuffix: Map<string, string[]> };
export type ResolveTables = Lookup & { files: { has(p: string): boolean } };

/** 경로 하나의 표 키: 소문자 파일명(`.md` 뗌)과 모든 경로 접미사. */
function pathKeys(p: string): { base: string; suffixes: string[] } {
  const parts = p.split('/');
  const base = (parts[parts.length - 1] ?? '').slice(0, -3).toLowerCase();
  const suffixes = parts.map((_, i) => parts.slice(i).join('/').toLowerCase());
  return { base, suffixes };
}

/** 파일 목록에서 파일명 표와 경로 접미사 표를 만든다(키는 소문자). */
export function buildLookup(files: Iterable<string>): Lookup {
  const byBase = new Map<string, string[]>();
  const bySuffix = new Map<string, string[]>();
  for (const p of files) {
    const k = pathKeys(p);
    pushTo(byBase, k.base, p);
    for (const s of k.suffixes) pushTo(bySuffix, s, p);
  }
  return { byBase, bySuffix };
}

/**
 * 링크 해석 규칙의 유일한 구현이다. 문서 집합(`tables.files`)과 표, 별칭 폴백만 받는다.
 * md: 정규화·`..` 탈출 null·`/` 끝은 README.md·집합 포함. wiki: `.md` 제거·`/` 트림·소문자,
 * `/` 있으면 접미사 표, 없으면 파일명 표(비면 별칭). 같은 폴더 → `/` 수 → 알파벳.
 */
export function resolveWith(
  tables: ResolveTables,
  aliasLookup: ((nameLower: string) => string[]) | undefined,
  source: string,
  link: { kind: 'wiki' | 'md'; target: string },
): Resolution {
  if (link.kind === 'md') {
    // 파이썬 os.path.join은 절대 대상이 앞을 버려 볼트 파일이 아니게 된다 — 같은 결과로 null이다.
    if (link.target.startsWith('/')) return { path: null, candidates: [] };
    let p = path.posix.normalize(path.posix.join(dirOf(source), link.target));
    if (p === '..' || p.startsWith('../')) return { path: null, candidates: [] };
    if (link.target.endsWith('/')) p = p.replace(/\/+$/, '') + '/README.md';
    return { path: tables.files.has(p) ? p : null, candidates: [] };
  }
  let t = link.target;
  if (t.toLowerCase().endsWith('.md')) t = t.slice(0, -3);
  t = t.replace(/^\/+|\/+$/g, '').toLowerCase();
  let hits = t.includes('/') ? tables.bySuffix.get(t + '.md') : tables.byBase.get(t);
  // alias는 경로 없는 이름일 때만 본다.
  if ((!hits || hits.length === 0) && !t.includes('/')) hits = aliasLookup?.(t);
  if (!hits || hits.length === 0) return { path: null, candidates: [] };
  const here = dirOf(source);
  const sorted = [...hits].sort((a, b) => {
    const sa = dirOf(a) === here ? 0 : 1;
    const sb = dirOf(b) === here ? 0 : 1;
    if (sa !== sb) return sa - sb;
    if (slashes(a) !== slashes(b)) return slashes(a) - slashes(b);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return { path: sorted[0] ?? null, candidates: sorted.length >= 2 ? sorted : [] };
}

/** lint 범위 안의 md 경로인가(절대경로·`..`·제외 폴더·raw/archive/private는 아니다). gitignore는 build만 본다. */
function inLintScope(p: string): boolean {
  if (p === '' || p.startsWith('/') || path.isAbsolute(p) || !p.endsWith('.md')) return false;
  const segs = p.split('/');
  if (segs.includes('..') || segs.includes('') || segs.includes('.')) return false;
  if (EXCLUDED_TOP.includes(segs[0] ?? '')) return false;
  return !segs.some((s) => EXCLUDED_DIRS.has(s));
}

function pushTo(table: Map<string, string[]>, key: string, value: string): void {
  const list = table.get(key);
  if (list) list.push(value);
  else table.set(key, [value]);
}

function dropFrom(table: Map<string, string[]>, key: string, value: string): void {
  const list = table.get(key);
  if (!list) return;
  const next = list.filter((v) => v !== value);
  if (next.length === 0) table.delete(key);
  else table.set(key, next);
}

export class VaultIndex {
  readonly root: string;
  private readonly fileSet = new Set<string>();
  private readonly records = new Map<string, Record_>();
  private readonly byBase = new Map<string, string[]>();
  private readonly bySuffix = new Map<string, string[]>();
  private readonly byAlias = new Map<string, string[]>();
  /** resolveWith에 넘기는 표 묶음. 맵은 build에서 비우기만 하고 바꿔 끼우지 않는다. */
  private readonly tables: ResolveTables = { files: this.fileSet, byBase: this.byBase, bySuffix: this.bySuffix };
  /** 대상 → (출발 → 링크 수). 역링크의 저장 형태다. */
  private readonly incoming = new Map<string, Map<string, number>>();
  /** 색인이 바뀔 때마다 오르는 번호. 그래프 응답이 낡았는지 보는 데 쓴다. */
  private ver = 0;

  constructor(root: string) {
    this.root = root;
  }

  get files(): ReadonlySet<string> {
    return this.fileSet;
  }

  /** 0 에서 시작해 build·update·remove(실제로 뺀 것만)마다 1 씩 오른다. */
  get version(): number {
    return this.ver;
  }

  /**
   * 전체 색인. 캐시(docs/link-graph.yml)를 받으면 해시가 같은 문서는 파싱하지 않고 제목·별칭·링크를 복원한다 —
   * 본문은 검색이 쓰므로 어느 쪽이든 파일은 읽는다. 해석(relink)은 항상 다시 한다.
   */
  build(opts: BuildOptions = {}): BuildStats {
    const t0 = performance.now();
    this.fileSet.clear();
    this.records.clear();
    this.byBase.clear();
    this.bySuffix.clear();
    this.byAlias.clear();
    this.incoming.clear();
    const cached = new Map<string, CachedDoc>();
    for (const d of opts.cache?.docs ?? []) cached.set(d.path.normalize('NFC'), d);
    const paths = walkLint(this.root, { strict: opts.strict });
    let hits = 0;
    for (const p of paths) {
      const bytes = this.readBytes(p);
      const hash = sha1(bytes);
      const doc = cached.get(p.normalize('NFC'));
      let rec: Record_;
      if (doc && doc.hash === hash.slice(0, HASH_LEN)) {
        rec = this.restore(p, bytes.toString('utf8'), hash, doc);
        hits += 1;
      } else {
        rec = this.parse(p, bytes.toString('utf8'), hash);
      }
      this.records.set(p, rec);
      this.fileSet.add(p);
      this.addToTables(p, rec.aliases);
    }
    for (const p of paths) this.relink(p);
    this.ver += 1;
    return { files: paths.length, cached: hits, parsed: paths.length - hits, ms: performance.now() - t0 };
  }

  /**
   * 캐시 파일에 쓸 모양. 문서는 경로순. 링크는 지금 해석 결과(`to`)로 묶는다 — 같은 (to, kind, 꼴) 은 하나로 합치고 수만 센다.
   * 해석되지 않은 링크는 줄·원문과 함께 따로 적되, lint 범위 md 가 될 수 없는 대상(raw/·이미지 등)은 적지 않는다.
   */
  snapshot(): LinkCache {
    const docs: CachedDoc[] = [];
    let links = 0;
    let pairs = 0;
    let unresolved = 0;
    for (const p of [...this.records.keys()].sort()) {
      const rec = this.need(p);
      const groups = new Map<string, CachedLink>();
      const broken: CachedBroken[] = [];
      for (const l of rec.links) {
        const kind = l.kind === 'md' ? 'md' : l.embed ? 'embed' : 'wiki';
        const to = this.resolve(p, l).path;
        if (to === null) {
          if (!neverResolves(p, l)) broken.push({ kind, line: l.line, target: l.target });
          continue;
        }
        const form = formOf(l, to);
        const key = [kind, to, form.stem ? 's' : '', form.target ?? ''].join('\0');
        const g = groups.get(key);
        if (g) g.count += 1;
        else groups.set(key, { kind, to, stem: form.stem, target: form.target, count: 1 });
      }
      const merged = [...groups.values()];
      for (const g of merged) links += g.count;
      pairs += merged.length;
      unresolved += broken.length;
      docs.push({ path: p.normalize('NFC'), hash: rec.hash.slice(0, HASH_LEN), title: rec.title, aliases: [...rec.aliases], links: merged, broken });
    }
    const d = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    return {
      schema: SCHEMA,
      parser: parserFingerprint(),
      generated: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      resolver: RESOLVER,
      files: docs.length,
      links: links + unresolved,
      pairs,
      unresolved,
      docs,
    };
  }

  title(p: string): string {
    return this.need(p).title;
  }

  aliases(p: string): string[] {
    return [...this.need(p).aliases];
  }

  kind(p: string): Kind {
    return this.need(p).kind;
  }

  topics(p: string): string[] {
    return [...this.need(p).topics];
  }

  /** 클러스터 키(1차 소스 `meta`). 저장하지 않고 부를 때 계산한다. */
  cluster(p: string): string {
    const rec = this.need(p);
    return clusterKeyOf(p, rec.kind, rec.topics);
  }

  /** 방향 쌍 단위 연결 수. 두 표에서 그때그때 센다. */
  degree(p: string): { in: number; out: number } {
    this.need(p);
    return { in: this.incoming.get(p)?.size ?? 0, out: this.outgoing(p).length };
  }

  /** frontmatter를 뗀 본문이다(색인할 때 읽은 것). */
  body(p: string): string {
    return this.need(p).body;
  }

  resolve(source: string, link: { kind: 'wiki' | 'md'; target: string }): Resolution {
    return resolveWith(this.tables, (name) => this.aliasLookup(name), source, link);
  }

  /** 별칭 표의 적중(소문자 이름). 소스 파일 집합 해석기가 폴백으로 쓴다. */
  aliasLookup(nameLower: string): string[] {
    return [...(this.byAlias.get(nameLower) ?? [])];
  }

  backlinks(p: string): Backlink[] {
    const bySource = this.incoming.get(p);
    if (!bySource) return [];
    const out: Backlink[] = [];
    for (const [src, count] of bySource) out.push({ path: src, title: this.records.get(src)?.title ?? src, count });
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  /**
   * 해석된 실제 링크의 대상만 낸다. 파이썬 Vault.edges에 더해지는 폴더 색인
   * (`<!-- docmap: folder -->` README)의 포함 간선은 링크가 아니라서 일부러 따라 하지 않는다.
   */
  outgoing(p: string): string[] {
    return [...new Set(this.need(p).edges)].sort();
  }

  /**
   * 파일 하나를 다시 읽어 그 기록과 간선만 바꾼다. 디스크에 없으면 remove와 같다.
   * 문서 집합이나 alias가 바뀌면 다른 문서의 링크가 다른 곳을 가리킬 수 있어,
   * 그때만 (디스크를 다시 읽지 않고) 저장된 링크를 다시 해석한다.
   */
  update(p: string): void {
    if (!inLintScope(p)) {
      // 범위 밖 경로는 바꾸지 않는다. 이미 색인된 것(범위가 바뀐 경우)이면 뺀다.
      this.remove(p);
      return;
    }
    if (!this.exists(p)) {
      this.remove(p);
      return;
    }
    const old = this.records.get(p);
    const rec = this.read(p);
    const membershipChanged = !old || old.aliases.join('\0') !== rec.aliases.join('\0');
    if (old) {
      this.unlink(p);
      this.dropFromTables(p, old.aliases);
    }
    this.records.set(p, rec);
    this.fileSet.add(p);
    this.addToTables(p, rec.aliases);
    this.relink(p);
    if (membershipChanged) this.relinkOthers(p);
    this.ver += 1;
  }

  remove(p: string): void {
    const old = this.records.get(p);
    if (!old) return;
    this.unlink(p);
    this.dropFromTables(p, old.aliases);
    this.records.delete(p);
    this.fileSet.delete(p);
    this.relinkOthers(p);
    this.ver += 1;
  }

  private need(p: string): Record_ {
    const rec = this.records.get(p);
    if (!rec) throw new Error(`색인에 없는 문서다: ${p}`);
    return rec;
  }

  private exists(p: string): boolean {
    try {
      return fs.statSync(path.join(this.root, p)).isFile();
    } catch {
      return false;
    }
  }

  private readBytes(p: string): Buffer {
    try {
      return fs.readFileSync(path.join(this.root, p));
    } catch {
      return Buffer.alloc(0);
    }
  }

  private read(p: string): Record_ {
    const bytes = this.readBytes(p);
    return this.parse(p, bytes.toString('utf8'), sha1(bytes));
  }

  private parse(p: string, text: string, hash: string): Record_ {
    const { data, body } = splitFrontmatter(text);
    return {
      hash,
      title: titleOf(p, data, body),
      aliases: aliasesOf(data),
      kind: kindOf(p, data),
      topics: topicsOf(data),
      body,
      links: extractLinks(text),
      edges: [],
    };
  }

  /**
   * 캐시 항목으로 기록을 복원한다. 마크다운은 파싱하지 않는다 — frontmatter만 떼어 종류·주제를 판정한다.
   * 묶인 링크는 수만큼 되살리고, 대상은 경로에서 해석 결과가 같은 꼴로 다시 만든다(줄 번호·label 은 색인이 쓰지 않는다).
   */
  private restore(p: string, text: string, hash: string, doc: CachedDoc): Record_ {
    const { data, body } = splitFrontmatter(text);
    const links: LinkRef[] = [];
    for (const l of doc.links) {
      const target = targetOf(p, l.kind, l.to, l);
      const ref: LinkRef = { kind: l.kind === 'md' ? 'md' : 'wiki', target, anchor: null, label: target, line: 0, embed: l.kind === 'embed' };
      for (let i = 0; i < l.count; i += 1) links.push(ref);
    }
    for (const b of doc.broken) links.push({ kind: b.kind === 'md' ? 'md' : 'wiki', target: b.target, anchor: null, label: b.target, line: b.line, embed: b.kind === 'embed' });
    return { hash, title: doc.title, aliases: [...doc.aliases], kind: kindOf(p, data), topics: topicsOf(data), body, links, edges: [] };
  }

  private tableKeys(p: string, aliases: string[]): { base: string; suffixes: string[]; aliasKeys: string[] } {
    const { base, suffixes } = pathKeys(p);
    const aliasKeys = [...new Set(aliases.map((a) => a.toLowerCase()))];
    return { base, suffixes, aliasKeys };
  }

  private addToTables(p: string, aliases: string[]): void {
    const k = this.tableKeys(p, aliases);
    pushTo(this.byBase, k.base, p);
    for (const s of k.suffixes) pushTo(this.bySuffix, s, p);
    for (const a of k.aliasKeys) pushTo(this.byAlias, a, p);
  }

  private dropFromTables(p: string, aliases: string[]): void {
    const k = this.tableKeys(p, aliases);
    dropFrom(this.byBase, k.base, p);
    for (const s of k.suffixes) dropFrom(this.bySuffix, s, p);
    for (const a of k.aliasKeys) dropFrom(this.byAlias, a, p);
  }

  /** 출발 문서의 옛 간선을 역링크 표에서 뺀다. */
  private unlink(source: string): void {
    const rec = this.records.get(source);
    if (!rec) return;
    for (const target of new Set(rec.edges)) {
      const bySource = this.incoming.get(target);
      if (!bySource) continue;
      bySource.delete(source);
      if (bySource.size === 0) this.incoming.delete(target);
    }
    rec.edges = [];
  }

  /** 출발 문서의 링크를 해석해 간선과 역링크 표를 새로 채운다. */
  private relink(source: string): void {
    const rec = this.records.get(source);
    if (!rec) return;
    const edges: string[] = [];
    for (const l of rec.links) {
      const dst = this.resolve(source, l).path;
      if (dst && dst !== source) edges.push(dst);
    }
    rec.edges = edges;
    for (const target of edges) {
      let bySource = this.incoming.get(target);
      if (!bySource) this.incoming.set(target, (bySource = new Map()));
      bySource.set(source, (bySource.get(source) ?? 0) + 1);
    }
  }

  private relinkOthers(changed: string): void {
    for (const src of this.records.keys()) {
      if (src === changed) continue;
      this.unlink(src);
      this.relink(src);
    }
  }
}
