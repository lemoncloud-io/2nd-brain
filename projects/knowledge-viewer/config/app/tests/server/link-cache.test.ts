import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

import { CACHE_PATH, RESOLVER, SCHEMA, brokenLinks, diffCache, isClean, isUsable, nodeKey, parserDependencyVersions, parserFingerprint, readCache, readCacheResult, serialize, writeCache } from '../../server/link-cache.ts';
import type { LinkCache } from '../../server/link-cache.ts';
import { VaultIndex } from '../../server/index-store.ts';
import { createViewerServer } from '../../server/main.ts';
import { makeFixtureVault } from '../helpers/fixture.ts';

function sample(parser = parserFingerprint()): LinkCache {
  return {
    schema: SCHEMA,
    parser,
    generated: '2026-10-23',
    resolver: RESOLVER,
    files: 2,
    links: 5,
    pairs: 3,
    unresolved: 1,
    docs: [
      { path: 'wiki/b.md', hash: 'h2', title: 'B "따옴표"', aliases: [], links: [], broken: [] },
      {
        path: 'wiki/a.md',
        hash: 'h1',
        title: 'A',
        aliases: ['에이'],
        links: [
          { kind: 'wiki', to: 'wiki/b.md', stem: false, target: null, count: 1 },
          { kind: 'md', to: 'wiki/b.md', stem: false, target: null, count: 2 },
          { kind: 'embed', to: 'wiki/b.md', stem: true, target: null, count: 1 },
        ],
        broken: [{ kind: 'md', line: 9, target: '../x.md' }],
      },
    ],
  };
}

type Graph = { schema: number; files: number; nodes: unknown[][]; edges: unknown[][]; broken: unknown[][] };

describe('link-cache 직렬화', () => {
  it('yaml로 되읽히고 결정적이며 행 번호·묶음·생략 규칙을 지킨다', () => {
    const text = serialize(sample());
    assert.equal(text, serialize(sample()));
    const back = parse(text) as Graph;
    assert.equal(back.schema, 3);
    assert.equal(back.files, 2);
    // 노드는 경로순 [경로, 해시, 제목, 별칭?]. 엣지·깨진 링크는 행 번호로 가리킨다.
    assert.deepEqual(back.nodes, [['wiki/a.md', 'h1', 'A', ['에이']], ['wiki/b.md', 'h2', 'B "따옴표"']]);
    assert.deepEqual(back.edges, [[0, 1, [1, 'm', 2], [1, 'es']]]);
    assert.deepEqual(back.broken, [[0, 9, '../x.md', 'm']]);
    assert.match(text, /^- \[0,1,\[1,"m",2\],\[1,"es"\]\]$/m);
    assert.match(text, /^links: 5$/m);
    assert.match(text, /^# Link Graph/);
    // 조인 키는 파일에 적지 않는다 — 경로에서 계산한다.
    assert.ok(!text.includes(nodeKey('wiki/a.md')));
  });

  it('조인 키는 NFC 경로 sha1 의 앞 12자다', () => {
    assert.equal(nodeKey('wiki/a.md'), crypto.createHash('sha1').update('wiki/a.md').digest('hex').slice(0, 12));
    assert.equal(nodeKey('wiki/한글.md'.normalize('NFD')), nodeKey('wiki/한글.md'));
  });

  it('빠른 길과 yaml 패키지가 같은 캐시를 낸다', () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kv-lc-'));
    try {
      const text = serialize(sample());
      fs.writeFileSync(path.join(dir, 'fast.yml'), text);
      // 목록을 들여 쓰면 빠른 길의 줄 꼴이 아니다 — yaml 패키지로 읽는다.
      fs.writeFileSync(path.join(dir, 'slow.yml'), text.replace(/^- \[/gm, '  - ['));
      const fast = readCache(dir, 'fast.yml');
      assert.ok(fast);
      assert.deepEqual(readCache(dir, 'slow.yml'), fast);
      assert.deepEqual(fast.docs, [...sample().docs].reverse());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parserFingerprint는 40자 hex 고정값이다', () => {
    const a = parserFingerprint();
    assert.match(a, /^[0-9a-f]{40}$/);
    assert.equal(a, parserFingerprint());
  });
});

describe('link-cache 읽기', () => {
  let fx: ReturnType<typeof makeFixtureVault>;
  beforeEach(() => {
    fx = makeFixtureVault();
  });
  afterEach(() => fx.cleanup());

  it('없으면 null이고 isUsable은 false', () => {
    assert.equal(readCache(fx.root), null);
    assert.equal(isUsable(null), false);
  });

  it('serialize한 것을 되읽으면 같은 구조고 쓸 수 있다', () => {
    const file = path.join(fx.root, CACHE_PATH);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serialize(sample()));
    const back = readCache(fx.root);
    assert.ok(back);
    assert.equal(isUsable(back), true);
    assert.equal(back.docs.length, 2);
    assert.equal(back.pairs, 3);
    assert.equal(back.links, 5);
    assert.deepEqual(back.docs[0]?.links[1], { kind: 'md', to: 'wiki/b.md', stem: false, target: null, count: 2 });
    assert.deepEqual(back.docs[0]?.broken, [{ kind: 'md', line: 9, target: '../x.md' }]);
  });

  it('schema나 parser가 다르면 isUsable은 false, 깨진 파일은 null', () => {
    const file = path.join(fx.root, CACHE_PATH);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serialize({ ...sample(), schema: 99 }));
    assert.equal(isUsable(readCache(fx.root)), false);
    fs.writeFileSync(file, serialize(sample('0'.repeat(40))));
    assert.equal(isUsable(readCache(fx.root)), false);
    fs.writeFileSync(file, 'schema: [1\n');
    assert.equal(readCache(fx.root), null);
    fs.writeFileSync(file, 'schema: 3\nnodes: "no"\nedges: []\n');
    assert.equal(readCache(fx.root), null);
    // 다른 스키마(스키마 1 꼴)는 못 읽는 것이 아니라 쓸 수 없는 캐시다.
    fs.writeFileSync(file, 'schema: 1\nparser: "x"\ndocs:\n  - path: "wiki/a.md"\n    hash: "h"\n    title: "A"\n');
    const old = readCache(fx.root);
    assert.ok(old);
    assert.equal(old.schema, 1);
    assert.equal(isUsable(old), false);
    // 머지된 스키마 2(키 문자열·raw 바깥 노드) 꼴도 쓸 수 없는 캐시다 — 전부 파싱하고 update 가 3 으로 다시 쓴다.
    fs.writeFileSync(file, `schema: 2\nparser: "${parserFingerprint()}"\nnodes:\n  "0123456789ab": {p: "wiki/a.md", h: "h", t: "A"}\nedges:\n- ["0123456789ab",null,"md",3,"../x.md"]\n`);
    const two = readCache(fx.root);
    assert.ok(two);
    assert.equal(two.schema, 2);
    assert.equal(two.docs.length, 0);
    assert.equal(isUsable(two), false);
  });
});

function assertSameIndex(a: VaultIndex, b: VaultIndex): void {
  assert.deepEqual([...b.files].sort(), [...a.files].sort());
  for (const f of a.files) {
    assert.equal(b.title(f), a.title(f), `title ${f}`);
    assert.deepEqual(b.aliases(f), a.aliases(f), `aliases ${f}`);
    assert.deepEqual(b.outgoing(f), a.outgoing(f), `outgoing ${f}`);
    assert.deepEqual(b.backlinks(f), a.backlinks(f), `backlinks ${f}`);
    assert.equal(b.body(f), a.body(f), `body ${f}`);
  }
}

describe('VaultIndex + 캐시', () => {
  let fx: ReturnType<typeof makeFixtureVault>;
  beforeEach(() => {
    fx = makeFixtureVault();
  });
  afterEach(() => fx.cleanup());

  it('최신 캐시면 파싱 0, 결과는 캐시 없는 색인과 같다', () => {
    const fresh = new VaultIndex(fx.root);
    const s0 = fresh.build();
    assert.equal(s0.parsed, s0.files);
    assert.equal(s0.cached, 0);
    assert.ok(s0.files >= 5);
    const cache = fresh.snapshot();
    assert.equal(cache.schema, SCHEMA);
    assert.equal(cache.parser, parserFingerprint());
    assert.equal(cache.files, s0.files);
    assert.match(cache.generated, /^\d{4}-\d{2}-\d{2}$/);
    const alpha = cache.docs.find((d) => d.path === 'wiki/alpha.md');
    assert.ok(alpha);
    assert.match(alpha.hash, /^[0-9a-f]{16}$/);
    assert.deepEqual(alpha.aliases, ['알파', 'Alpha Note']);
    // [[beta]]·[[beta\|베타]]·[[beta#둘째|절]] 은 같은 (to, kind, 파일명 꼴) — 하나로 묶고 3 을 센다.
    assert.deepEqual(alpha.links, [
      { kind: 'wiki', to: 'wiki/beta.md', stem: true, target: null, count: 3 },
      { kind: 'wiki', to: 'projects/demo/README.md', stem: false, target: null, count: 1 },
    ]);
    const readme = cache.docs.find((d) => d.path === 'projects/demo/README.md');
    assert.ok(readme);
    assert.deepEqual(readme.links.map((l) => [l.kind, l.to]), [['wiki', 'wiki/alpha.md'], ['md', 'wiki/beta.md']]);
    assert.deepEqual(readme.broken, [{ kind: 'md', line: 11, target: '../' }]);

    const warm = new VaultIndex(fx.root);
    const s1 = warm.build({ cache });
    assert.equal(s1.parsed, 0);
    assert.equal(s1.cached, s0.files);
    assertSameIndex(fresh, warm);
    assert.deepEqual(warm.snapshot().docs, cache.docs);
  });

  it('낡은 캐시 — 수정·추가·삭제 뒤 바뀐 것만 파싱하고 결과는 같다', () => {
    const first = new VaultIndex(fx.root);
    first.build();
    const stale = first.snapshot();
    fs.appendFileSync(path.join(fx.root, 'wiki/alpha.md'), '\n또 [[beta|두 번째]] 링크.\n');
    fs.writeFileSync(path.join(fx.root, 'wiki/gamma.md'), '---\ntype: concept\n---\n\n# 감마\n\n[[alpha]] 로 간다.\n');
    fs.rmSync(path.join(fx.root, 'projects/demo/beta.md'));

    const warm = new VaultIndex(fx.root);
    const s = warm.build({ cache: stale });
    assert.equal(s.parsed, 2);
    assert.equal(s.cached, s.files - 2);
    assert.ok(!warm.files.has('projects/demo/beta.md'));
    const fresh = new VaultIndex(fx.root);
    fresh.build();
    assertSameIndex(fresh, warm);
    assert.equal(warm.backlinks('wiki/alpha.md').some((b) => b.path === 'wiki/gamma.md'), true);
    assert.deepEqual(warm.backlinks('wiki/beta.md').filter((b) => b.path === 'wiki/alpha.md').map((b) => b.count), [4]);
  });
});

describe('link-cache 대조', () => {
  let fx: ReturnType<typeof makeFixtureVault>;
  let old: LinkCache;
  beforeEach(() => {
    fx = makeFixtureVault();
    const idx = new VaultIndex(fx.root);
    idx.build();
    old = idx.snapshot();
  });
  afterEach(() => fx.cleanup());
  const current = (): LinkCache => {
    const idx = new VaultIndex(fx.root);
    idx.build({ cache: old });
    return idx.snapshot();
  };

  it('같으면 깨끗하다 — generated 가 달라도', () => {
    const d = diffCache({ ...old, generated: '2000-01-01' }, current());
    assert.equal(isClean(d), true);
    assert.deepEqual(d, { schema: false, parser: false, missing: [], gone: [], stale: [], drift: [] });
  });

  it('수정·추가·삭제는 stale·missing·gone', () => {
    fs.appendFileSync(path.join(fx.root, 'wiki/alpha.md'), '\n더.\n');
    fs.writeFileSync(path.join(fx.root, 'wiki/gamma.md'), '# 감마\n');
    fs.rmSync(path.join(fx.root, 'projects/demo/beta.md'));
    const d = diffCache(old, current());
    assert.equal(isClean(d), false);
    assert.deepEqual(d.stale, ['wiki/alpha.md']);
    assert.deepEqual(d.missing, ['wiki/gamma.md']);
    assert.deepEqual(d.gone, ['projects/demo/beta.md']);
    assert.deepEqual(d.drift, []);
  });

  it('이웃의 별칭 변경으로 해석이 바뀌면 해시가 같아도 drift', () => {
    // alpha 의 [[beta]] 는 wiki/beta.md 로 간다. beta 를 지우고 demo/beta 에 alias 를 주면 alpha 는 바이트 그대로인데 to 가 바뀐다.
    fs.rmSync(path.join(fx.root, 'wiki/beta.md'));
    const d = diffCache(old, current());
    assert.deepEqual(d.gone, ['wiki/beta.md']);
    assert.ok(d.drift.includes('wiki/alpha.md'), `drift: ${d.drift.join(',')}`);
    assert.ok(d.drift.includes('projects/demo/README.md'));
  });

  it('schema·parser 불일치와 캐시 없음', () => {
    assert.equal(diffCache(null, current()).schema, true);
    assert.equal(diffCache({ ...old, schema: 99 }, current()).schema, true);
    const p = diffCache({ ...old, parser: '0'.repeat(40) }, current());
    assert.equal(p.parser, true);
    assert.equal(p.schema, false);
    assert.equal(isClean(p), false);
  });

  it('brokenLinks 는 to: null 인 링크다', () => {
    const broken = brokenLinks(old);
    assert.deepEqual(broken, [{ path: 'projects/demo/README.md', line: 11, target: '../' }]);
  });
});

describe('link-cache CLI', () => {
  const CLI = path.join(import.meta.dirname, '..', '..', 'link-cache.ts');
  let fx: ReturnType<typeof makeFixtureVault>;
  beforeEach(() => {
    fx = makeFixtureVault();
  });
  afterEach(() => fx.cleanup());
  const cli = (root: string, ...args: string[]) =>
    spawnSync(process.execPath, [CLI, ...args, '--vault', root], { encoding: 'utf8' });
  const cacheFile = (): string => path.join(fx.root, CACHE_PATH);

  it('build → 파일이 생기고 verify 는 0', () => {
    const b = cli(fx.root, 'build');
    assert.equal(b.status, 0, b.stderr);
    assert.ok(fs.existsSync(cacheFile()));
    assert.match(b.stdout, /문서 \d+/);
    const v = cli(fx.root, 'verify');
    assert.equal(v.status, 0, v.stdout + v.stderr);
    assert.match(v.stdout, /깨진 링크 1/);
  });

  it('수정 → verify 1(stale) → update 0 → verify 0', () => {
    cli(fx.root, 'build');
    fs.appendFileSync(path.join(fx.root, 'wiki/alpha.md'), '\n더.\n');
    const v1 = cli(fx.root, 'verify');
    assert.equal(v1.status, 1);
    assert.match(v1.stdout, /stale 1/);
    assert.match(v1.stdout, /wiki\/alpha\.md/);
    const u = cli(fx.root, 'update');
    assert.equal(u.status, 0, u.stderr);
    assert.match(u.stdout, /파싱 1\b/);
    assert.equal(cli(fx.root, 'verify').status, 0);
  });

  it('update 는 변경 없으면 파일을 다시 쓰지 않는다', () => {
    cli(fx.root, 'build');
    const before = fs.statSync(cacheFile());
    const old = new Date(2000, 0, 1);
    fs.utimesSync(cacheFile(), old, old);
    const u = cli(fx.root, 'update');
    assert.equal(u.status, 0);
    assert.match(u.stdout, /변경 없음/);
    assert.equal(fs.statSync(cacheFile()).mtimeMs, old.getTime());
    assert.equal(fs.statSync(cacheFile()).size, before.size);
  });

  it('build 와 update 의 바이트가 같다', () => {
    cli(fx.root, 'build');
    const a = fs.readFileSync(cacheFile(), 'utf8');
    fs.rmSync(cacheFile());
    cli(fx.root, 'build');
    fs.appendFileSync(path.join(fx.root, 'wiki/beta.md'), '\n더.\n');
    cli(fx.root, 'update');
    const viaUpdate = fs.readFileSync(cacheFile(), 'utf8');
    cli(fx.root, 'build');
    assert.equal(fs.readFileSync(cacheFile(), 'utf8'), viaUpdate);
    assert.notEqual(viaUpdate, a);
  });

  it('schema 가 다른 캐시: verify 2', () => {
    cli(fx.root, 'build');
    fs.writeFileSync(cacheFile(), fs.readFileSync(cacheFile(), 'utf8').replace('schema: 3', 'schema: 99'));
    const v = cli(fx.root, 'verify');
    assert.equal(v.status, 2);
    assert.match(v.stdout + v.stderr, /schema/);
    assert.equal(cli(fx.root, 'verify').status, 2);
  });

  it('parser 지문이 다른 캐시: verify 1(parser), update 가 전부 파싱해 고친다', () => {
    cli(fx.root, 'build');
    fs.writeFileSync(cacheFile(), fs.readFileSync(cacheFile(), 'utf8').replace(/^parser: ".*"$/m, `parser: "${'0'.repeat(40)}"`));
    const v = cli(fx.root, 'verify');
    assert.equal(v.status, 1);
    assert.match(v.stdout, /parser/);
    const u = cli(fx.root, 'update');
    assert.equal(u.status, 0);
    assert.match(u.stdout, /캐시 0/);
    assert.equal(cli(fx.root, 'verify').status, 0);
  });

  it('git 작업 트리가 아니면 build 는 쓰지 않고 2', () => {
    const copy = path.join(path.dirname(fx.root), 'nogit');
    fs.cpSync(fx.root, copy, { recursive: true });
    fs.rmSync(path.join(copy, '.git'), { recursive: true, force: true });
    const b = cli(copy, 'build');
    assert.equal(b.status, 2);
    assert.match(b.stderr, /git/);
    assert.ok(!fs.existsSync(path.join(copy, CACHE_PATH)));
  });

  it('--broken 이 깨진 링크 줄을 내고, 명령이 없으면 2', () => {
    cli(fx.root, 'build');
    const v = cli(fx.root, 'verify', '--broken');
    assert.equal(v.status, 0);
    assert.match(v.stdout, /projects\/demo\/README\.md:11 ‹\.\.\/›/);
    assert.equal(cli(fx.root).status, 2);
    assert.equal(cli(fx.root, 'frobnicate').status, 2);
  });
});

describe('서버 시작과 캐시', () => {
  let fx: ReturnType<typeof makeFixtureVault>;
  beforeEach(() => {
    fx = makeFixtureVault();
  });
  afterEach(() => fx.cleanup());
  const distDir = path.join(import.meta.dirname, '..', 'fixtures', 'dist-none');
  const start = (): string[] => {
    const lines: string[] = [];
    const server = createViewerServer({ root: fx.root, includePrivate: false, distDir, watch: false, log: (l) => lines.push(l) });
    server.close();
    return lines;
  };

  it('캐시가 없으면 전부 파싱한다고 찍는다', () => {
    const lines = start();
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? '', /^색인 \d+ 문서 \(캐시 0 · 파싱 \d+\) \d+\.\ds$/);
  });

  it('캐시가 있으면 파싱 0 이다', () => {
    const idx = new VaultIndex(fx.root);
    idx.build();
    fs.mkdirSync(path.join(fx.root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(fx.root, CACHE_PATH), serialize(idx.snapshot()));
    const lines = start();
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? '', /^색인 (\d+) 문서 \(캐시 \1 · 파싱 0\)/);
  });

  it('schema 가 다른 캐시는 경고 한 줄 뒤 전부 파싱한다', () => {
    fs.mkdirSync(path.join(fx.root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(fx.root, CACHE_PATH), 'schema: 99\ndocs: []\n');
    const lines = start();
    assert.equal(lines.length, 2);
    assert.match(lines[0] ?? '', /docs\/link-graph\.yml 을 쓰지 않는다 — schema·parser 불일치/);
    assert.match(lines[1] ?? '', /캐시 0 · 파싱 \d+/);
  });
});

describe('리뷰 수정 — 지문·미추적·절대 경로·못 읽는 캐시·별칭 drift', () => {
  let fx: ReturnType<typeof makeFixtureVault>;
  beforeEach(() => {
    fx = makeFixtureVault();
  });
  afterEach(() => fx.cleanup());
  const CLI = path.join(import.meta.dirname, '..', '..', 'link-cache.ts');
  const cli = (root: string, ...args: string[]) => spawnSync(process.execPath, [CLI, ...args, '--vault', root], { encoding: 'utf8' });

  it('지문은 잠금 파일의 파서 계열 패키지 버전만 본다 — react 는 아니다', () => {
    const lock = {
      packages: {
        '': { dependencies: { react: '^19' } },
        'node_modules/react': { version: '19.1.0' },
        'node_modules/mdast-util-from-markdown': { version: '2.1.0' },
        'node_modules/micromark-core-commonmark': { version: '2.0.3' },
        'node_modules/mdast-util-gfm-table': { version: '2.0.0' },
        'node_modules/remark-gfm': { version: '4.0.1' },
        'node_modules/unist-util-visit': { version: '5.0.0' },
        'node_modules/yaml': { version: '2.9.1' },
        'node_modules/some-dep/node_modules/micromark-util-types': { version: '2.0.2' },
      },
    };
    assert.deepEqual(parserDependencyVersions(lock), [
      'mdast-util-from-markdown@2.1.0',
      'mdast-util-gfm-table@2.0.0',
      'micromark-core-commonmark@2.0.3',
      'micromark-util-types@2.0.2',
      'remark-gfm@4.0.1',
      'unist-util-visit@5.0.0',
      'yaml@2.9.1',
    ]);
    // 실제 잠금 파일에서도 micromark 계열이 잡힌다.
    const real = parserDependencyVersions(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'package-lock.json'), 'utf8')));
    assert.ok(real.some((v) => v.startsWith('micromark-core-commonmark@')), real.join(','));
    assert.ok(!real.some((v) => v.startsWith('react@')));
  });

  it('build·update 는 포함된 미추적 md 를 알린다', () => {
    fs.writeFileSync(path.join(fx.root, 'wiki/draft.md'), '# 초안\n');
    const b = cli(fx.root, 'build');
    assert.equal(b.status, 0, b.stderr);
    assert.match(b.stdout, /미추적 md 1 — 커밋 전에 확인한다/);
    assert.match(b.stdout, /^  wiki\/draft\.md$/m);
    const c = cli(fx.root, 'update');
    assert.doesNotMatch(c.stdout, /미추적 md 0/);
  });

  it('--cache 절대 경로는 볼트 안으로 접히지 않는다', () => {
    const idx = new VaultIndex(fx.root);
    idx.build();
    const abs = path.join(path.dirname(fx.root), 'elsewhere', 'g.yml');
    assert.equal(writeCache(fx.root, idx.snapshot(), abs), true);
    assert.ok(fs.existsSync(abs));
    assert.ok(!fs.existsSync(path.join(fx.root, abs)));
    assert.ok(isUsable(readCache(fx.root, abs)));
  });

  it('못 읽는 캐시는 "없다" 가 아니라 "읽지 못했다" 다 — CLI 와 서버 둘 다', () => {
    fs.mkdirSync(path.join(fx.root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(fx.root, CACHE_PATH), '<<<<<<< HEAD\nschema: 1\n=======\n');
    assert.deepEqual(readCacheResult(fx.root).status, 'unreadable');
    assert.deepEqual(readCacheResult(fx.root, 'docs/none.yml').status, 'absent');
    const v = cli(fx.root, 'verify');
    assert.equal(v.status, 2);
    assert.match(v.stdout, /읽지 못했다/);
    const lines: string[] = [];
    const server = createViewerServer({ root: fx.root, includePrivate: false, distDir: path.join(fx.root, 'no-dist'), watch: false, log: (l) => lines.push(l) });
    server.close();
    assert.equal(lines.length, 2);
    assert.match(lines[0] ?? '', /docs\/link-graph\.yml 을 읽지 못했다 — 전부 파싱한다/);
  });

  it('이웃의 별칭 추가로 해석이 생기면 바이트가 같은 문서가 drift 다', () => {
    fs.writeFileSync(path.join(fx.root, 'wiki/delta.md'), '---\ntype: concept\n---\n\n# 델타\n\n[[감마]] 로 간다.\n');
    const before = new VaultIndex(fx.root);
    before.build();
    const old = before.snapshot();
    assert.deepEqual(old.docs.find((d) => d.path === 'wiki/delta.md')?.broken.map((b) => b.target), ['감마']);
    fs.writeFileSync(path.join(fx.root, 'wiki/beta.md'), fs.readFileSync(path.join(fx.root, 'wiki/beta.md'), 'utf8').replace('type: concept\n', 'type: concept\naliases: [감마]\n'));
    const after = new VaultIndex(fx.root);
    after.build({ cache: old });
    const d = diffCache(old, after.snapshot());
    assert.deepEqual(d.stale, ['wiki/beta.md']);
    assert.deepEqual(d.drift, ['wiki/delta.md']);
    assert.equal(after.snapshot().docs.find((doc) => doc.path === 'wiki/delta.md')?.links[0]?.to, 'wiki/beta.md');
  });
});

describe('스키마 2 — 묶음·꼴·md 끼리만', () => {
  let fx: ReturnType<typeof makeFixtureVault>;
  beforeEach(() => {
    fx = makeFixtureVault();
  });
  afterEach(() => fx.cleanup());
  const FORMS = [
    '# 꼴',
    '',
    '[[beta]] 와 [[beta|다시]] 와 [[projects/demo/README]]',
    '[[알파]] 는 별칭이다. [상대](../../wiki/beta.md) · ![[beta]]',
    '![[그림.png]] · [원문](../../raw/src.md) · [[#절]] · [[없는 문서]]',
    '',
  ].join('\n');

  it('같은 (to, kind, 꼴) 은 묶고, 별칭만 원문을 적고, md 가 될 수 없는 대상은 버린다', () => {
    fs.writeFileSync(path.join(fx.root, 'projects/demo/forms.md'), FORMS);
    const idx = new VaultIndex(fx.root);
    idx.build();
    const doc = idx.snapshot().docs.find((d) => d.path === 'projects/demo/forms.md');
    assert.ok(doc);
    assert.deepEqual(doc.links, [
      // 같은 폴더의 beta 가 이긴다. 파일명 꼴이라 stem.
      { kind: 'wiki', to: 'projects/demo/beta.md', stem: true, target: null, count: 2 },
      { kind: 'wiki', to: 'projects/demo/README.md', stem: false, target: null, count: 1 },
      { kind: 'wiki', to: 'wiki/alpha.md', stem: false, target: '알파', count: 1 },
      { kind: 'md', to: 'wiki/beta.md', stem: false, target: null, count: 1 },
      { kind: 'embed', to: 'projects/demo/beta.md', stem: true, target: null, count: 1 },
    ]);
    // 그림·raw/·같은 문서의 절은 lint 범위 md 가 될 수 없다 — 적지 않는다. 남는 깨진 링크는 하나다.
    assert.deepEqual(doc.broken, [{ kind: 'wiki', line: 5, target: '없는 문서' }]);
    assert.ok(!serialize(idx.snapshot()).includes('raw/src.md'));
  });

  it('문서 집합이 바뀌면 복원한 링크도 다시 해석한다 — 파일명 꼴은 파일명으로', () => {
    fs.writeFileSync(path.join(fx.root, 'projects/demo/forms.md'), FORMS);
    const first = new VaultIndex(fx.root);
    first.build();
    const cache = first.snapshot();
    // 같은 폴더의 beta 를 지우면 [[beta]] 는 wiki/beta.md 로 간다. forms.md 는 바이트 그대로라 캐시에서 복원된다.
    fs.rmSync(path.join(fx.root, 'projects/demo/beta.md'));
    fs.mkdirSync(path.join(fx.root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(fx.root, CACHE_PATH), serialize(cache));
    const warm = new VaultIndex(fx.root);
    warm.build({ cache: readCache(fx.root) ?? undefined });
    const cold = new VaultIndex(fx.root);
    cold.build();
    assertSameIndex(cold, warm);
    assert.deepEqual(warm.backlinks('wiki/beta.md').find((b) => b.path === 'projects/demo/forms.md'), { path: 'projects/demo/forms.md', title: '꼴', count: 4 });
    assert.ok(diffCache(cache, warm.snapshot()).drift.includes('projects/demo/forms.md'));
  });

  it('역링크는 보내는 문서마다 하나고 수를 센다 — 그래프 굵기도 같은 수다', () => {
    const idx = new VaultIndex(fx.root);
    idx.build();
    const fromAlpha = idx.backlinks('wiki/beta.md').filter((b) => b.path === 'wiki/alpha.md');
    assert.deepEqual(fromAlpha, [{ path: 'wiki/alpha.md', title: '알파', count: 3 }]);
  });
});
