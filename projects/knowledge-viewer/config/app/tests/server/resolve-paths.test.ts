// /api/resolve-paths — 본문 인라인 코드 경로 풀이. 차례(문서 폴더 → 루트), 종류(md·file·folder), 경계(`..`·private·제외 폴더),
// 소스별 존재(local 디스크 · main 커밋), 후보 상한(200)을 본다.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { CODE_PATH_MAX_BATCH } from '../../shared/code-path.ts';
import { LOCAL } from '../../shared/source.ts';
import { createViewerServer } from '../../server/main.ts';
import { resolveCodePaths } from '../../server/resolve-paths.ts';
import { localReader, SourceManager } from '../../server/source.ts';
import { makeGitFixture, type GitFixture } from '../helpers/git-fixture.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

describe('/api/resolve-paths', () => {
  let fx: GitFixture;
  let distTmp: string;
  const servers: http.Server[] = [];
  let base: string;
  let basePrivate: string;

  before(async () => {
    fx = makeGitFixture();
    // 커밋된 것: 문서 폴더 안의 같은 이름 문서(차례 시험), 설정 파일, 폴더.
    fx.commitOnMaster(
      {
        'projects/demo/wiki/beta.md': '# 문서 폴더 안의 beta\n',
        'projects/demo/outputs/2026-10-27-m1.md': '# m1\n',
        'projects/demo/config/app.yml': 'a: 1\n',
        'projects/demo/assets/only.png': 'png',
      },
      'demo files',
    );
    // 디스크에만 있는 것(git 소스에는 없다).
    fs.writeFileSync(path.join(fx.root, 'projects', 'demo', 'disk-only.ts'), 'export {};\n');
    fs.writeFileSync(path.join(fx.root, 'private', 'secret.md'), '# 비밀\n');
    distTmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kv-dist-'));
    const make = (includePrivate: boolean): http.Server =>
      createViewerServer({
        root: fx.root,
        includePrivate,
        distDir: path.join(distTmp, 'dist'),
        watch: false,
        gh: fx.gh,
        sources: new SourceManager(fx.root, { gh: fx.gh }),
        log: () => {},
      });
    servers.push(make(false), make(true));
    base = await listen(servers[0]!);
    basePrivate = await listen(servers[1]!);
  });
  after(async () => {
    for (const s of servers) await close(s);
    fx.cleanup();
    fs.rmSync(distTmp, { recursive: true, force: true });
  });

  const query = (from: string, cands: string[], src?: string): string => {
    const q = new URLSearchParams({ from });
    if (src !== undefined) q.set('src', src);
    for (const c of cands) q.append('p', c);
    return `/api/resolve-paths?${q.toString()}`;
  };
  const get = async (p: string, at = base): Promise<{ status: number; type: string; json: Json }> => {
    const res = await fetch(at + p);
    return { status: res.status, type: res.headers.get('content-type') ?? '', json: (await res.json()) as Json };
  };

  it('차례: 문서 폴더 기준이 먼저, 없으면 볼트 루트 기준', () => {
    const ctx = { root: fx.root, includePrivate: false };
    const reader = localReader(fx.root, false);
    const from = 'projects/demo/README.md';
    const r = resolveCodePaths(ctx, LOCAL, reader, from, ['wiki/beta.md', 'wiki/alpha.md', 'outputs/2026-10-27-m1.md', 'beta.md']);
    // 문서 폴더 안에도 있으면 그쪽.
    assert.deepEqual(r['wiki/beta.md'], { path: 'projects/demo/wiki/beta.md', kind: 'md' });
    // 문서 폴더에 없으면 루트.
    assert.deepEqual(r['wiki/alpha.md'], { path: 'wiki/alpha.md', kind: 'md' });
    assert.deepEqual(r['outputs/2026-10-27-m1.md'], { path: 'projects/demo/outputs/2026-10-27-m1.md', kind: 'md' });
    assert.deepEqual(r['beta.md'], { path: 'projects/demo/beta.md', kind: 'md' });
    // 루트의 문서에서는 루트 기준 하나뿐이다.
    const top = resolveCodePaths(ctx, LOCAL, reader, 'VAULT_RULES.md', ['wiki/beta.md', 'beta.md']);
    assert.deepEqual(top['wiki/beta.md'], { path: 'wiki/beta.md', kind: 'md' });
    assert.equal(top['beta.md'], null);
  });

  it('루트 기준은 조각이 둘 이상일 때만: 맨 이름·한 조각 폴더는 문서 폴더에서만 찾는다', () => {
    const ctx = { root: fx.root, includePrivate: false };
    const reader = localReader(fx.root, false);
    const r = resolveCodePaths(ctx, LOCAL, reader, 'projects/demo/README.md', ['VAULT_RULES.md', 'raw/', 'wiki/INDEX.md', 'beta.md', 'wiki/']);
    // 루트에만 있는 맨 이름·한 조각 폴더는 링크하지 않는다.
    assert.equal(r['VAULT_RULES.md'], null);
    assert.equal(r['raw/'], null);
    // 조각이 둘이면 루트 기준으로 찾는다.
    assert.deepEqual(r['wiki/INDEX.md'], { path: 'wiki/INDEX.md', kind: 'md' });
    // 문서 폴더에 있으면 맨 이름·한 조각 폴더도 찾는다.
    assert.deepEqual(r['beta.md'], { path: 'projects/demo/beta.md', kind: 'md' });
    assert.deepEqual(r['wiki/'], { path: 'projects/demo/wiki', kind: 'folder' });
    // 루트의 문서에서는 문서 폴더가 곧 루트다.
    const top = resolveCodePaths(ctx, LOCAL, reader, 'wiki/../VAULT_RULES.md', ['VAULT_RULES.md']);
    assert.equal(top['VAULT_RULES.md'], null); // 이상한 from 은 문서 폴더가 없다
    assert.deepEqual(resolveCodePaths(ctx, LOCAL, reader, 'INDEX.md', ['VAULT_RULES.md'])['VAULT_RULES.md'], { path: 'VAULT_RULES.md', kind: 'md' });
  });

  it('출처 문자열: 빈칸·괄호·`:`·`#` 든 `raw/…md` 는 루트 기준 그 경로 하나만 파일로 본다(문서 정보 패널)', () => {
    const ctx = { root: fx.root, includePrivate: false };
    const reader = localReader(fx.root, false);
    fs.mkdirSync(path.join(fx.root, 'raw'), { recursive: true });
    fs.writeFileSync(path.join(fx.root, 'raw', 'A Title (v2): part #1.md'), '# 원본\n');
    const r = resolveCodePaths(ctx, LOCAL, reader, 'wiki/topics/t.md', [
      'raw/A Title (v2): part #1.md',
      'raw/Missing title.md',
      'raw/../wiki/a b.md',
      'raw/ lead.md',
      'notes/a b.md',
    ]);
    assert.deepEqual(r['raw/A Title (v2): part #1.md'], { path: 'raw/A Title (v2): part #1.md', kind: 'md' });
    assert.equal(r['raw/Missing title.md'], null);
    assert.equal(r['raw/../wiki/a b.md'], null);
    assert.equal(r['raw/ lead.md'], null);
    // raw·archive 밖의 빈칸 경로는 후보가 아니다.
    assert.equal(r['notes/a b.md'], null);
  });

  it('local: 종류(md·file·folder), 앵커·줄 꼬리, 없는 것·후보 아닌 것은 null', async () => {
    const { status, type, json } = await get(
      query('projects/demo/README.md', [
        'config/app.yml',
        'disk-only.ts:3',
        'wiki/alpha.md#제목',
        'projects/demo/',
        'outputs',
        'config/',
        'config/app.yml/',
        'missing.md',
        'npm test',
        'https://x/y',
      ]),
    );
    assert.equal(status, 200);
    assert.match(type, /^application\/json/);
    assert.equal(json.source, 'local');
    assert.equal(json.from, 'projects/demo/README.md');
    assert.equal('truncated' in json, false);
    const p = json.paths;
    assert.deepEqual(p['config/app.yml'], { path: 'projects/demo/config/app.yml', kind: 'file' });
    assert.deepEqual(p['disk-only.ts:3'], { path: 'projects/demo/disk-only.ts', kind: 'file' });
    assert.deepEqual(p['wiki/alpha.md#제목'], { path: 'wiki/alpha.md', kind: 'md' });
    assert.deepEqual(p['projects/demo/'], { path: 'projects/demo', kind: 'folder' });
    // `/` 가 없고 확장자도 없으면 후보가 아니다.
    assert.equal(p['outputs'], null);
    assert.deepEqual(p['config/'], { path: 'projects/demo/config', kind: 'folder' });
    // 끝 `/` 는 폴더로만 찾는다 — 파일이면 null.
    assert.equal(p['config/app.yml/'], null);
    assert.equal(p['missing.md'], null);
    assert.equal(p['npm test'], null);
    assert.equal(p['https://x/y'], null);
  });

  it('경계: `..` 로 볼트 밖, 제외 폴더, private(로컬 비공개 꺼짐)는 null — private 켠 서버의 local 만 찾는다', async () => {
    const cands = ['../../../etc/hosts', '../../wiki/beta.md', 'node_modules/x.md', 'private/secret.md'];
    const off = (await get(query('projects/demo/README.md', cands))).json.paths;
    assert.equal(off['../../../etc/hosts'], null);
    // 볼트 안으로 올라가는 `..` 는 된다.
    assert.deepEqual(off['../../wiki/beta.md'], { path: 'wiki/beta.md', kind: 'md' });
    assert.equal(off['node_modules/x.md'], null);
    assert.equal(off['private/secret.md'], null);
    const on = (await get(query('projects/demo/README.md', cands), basePrivate)).json.paths;
    assert.deepEqual(on['private/secret.md'], { path: 'private/secret.md', kind: 'md' });
    // 한 조각 폴더(`private/`)는 문서 폴더 기준만이라 루트의 문서에서 묻는다.
    assert.equal((await get(query('VAULT_RULES.md', ['private/']))).json.paths['private/'], null);
    assert.deepEqual((await get(query('VAULT_RULES.md', ['private/']), basePrivate)).json.paths['private/'], { path: 'private', kind: 'folder' });
    // git 소스는 private 를 담지 않는다 — 비공개 켠 서버여도.
    const main = (await get(query('projects/demo/README.md', cands, 'main'), basePrivate)).json.paths;
    assert.equal(main['private/secret.md'], null);
    assert.equal((await get(query('VAULT_RULES.md', ['private/'], 'main'), basePrivate)).json.paths['private/'], null);
  });

  it('git 소스(main): 커밋에 있는 것만 — 디스크에만 있는 파일은 null, 폴더·이미지도 찾는다', async () => {
    const { status, json } = await get(
      query('projects/demo/README.md', ['disk-only.ts', 'config/app.yml', 'wiki/beta.md', 'assets/', 'assets/only.png', 'outputs/'], 'main'),
    );
    assert.equal(status, 200);
    assert.equal(json.source, 'main');
    const p = json.paths;
    assert.equal(p['disk-only.ts'], null);
    assert.deepEqual(p['config/app.yml'], { path: 'projects/demo/config/app.yml', kind: 'file' });
    assert.deepEqual(p['wiki/beta.md'], { path: 'projects/demo/wiki/beta.md', kind: 'md' });
    // md 가 없는 폴더는 ls-tree 로 확인한다.
    assert.deepEqual(p['assets/'], { path: 'projects/demo/assets', kind: 'folder' });
    assert.deepEqual(p['assets/only.png'], { path: 'projects/demo/assets/only.png', kind: 'file' });
    assert.deepEqual(p['outputs/'], { path: 'projects/demo/outputs', kind: 'folder' });
  });

  it('상한: 후보는 앞 200 개만 보고 truncated 를 단다, 300 자 넘는 후보는 null', async () => {
    const many = Array.from({ length: CODE_PATH_MAX_BATCH + 5 }, (_, i) => `n${i}.md`);
    const { status, json } = await get(query('projects/demo/README.md', many));
    assert.equal(status, 200);
    assert.equal(json.truncated, true);
    assert.equal(Object.keys(json.paths).length, CODE_PATH_MAX_BATCH);
    assert.equal(`n${CODE_PATH_MAX_BATCH}.md` in json.paths, false);
    const long = `${'a/'.repeat(150)}b.md`;
    assert.equal((await get(query('', [long]))).json.paths[long], null);
  });

  it('src 가 틀리면 400', async () => {
    assert.equal((await get(query('wiki/INDEX.md', ['wiki/beta.md'], 'nope'))).status, 400);
  });
});
