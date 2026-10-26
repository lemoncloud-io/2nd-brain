import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  PrSource,
  isRepoName,
  makeSpawnRunner,
  parsePrFiles,
  parsePrList,
  parseRepos,
  reasonOf,
  type GhResult,
  type GhRunner,
  type Pr,
  type PrFile,
} from '../../server/panels/prs.ts';
import { makeFixtureVault } from '../helpers/fixture.ts';

const ok = (stdout: string): GhResult => ({ stdout, stderr: '', status: 0 });
const bad = (stderr: string, status = 1): GhResult => ({ stdout: '', stderr, status });

// 가짜 PR. 실제 사람·레포 이름이 아니다.
const PR_LIST = JSON.stringify([
  { number: 1, title: 'alpha 고치기', assignees: [{ login: 'u1' }], author: { login: 'u1' }, headRefName: 'fix/alpha', updatedAt: '2026-10-23T01:00:00Z', url: 'https://example.test/pr/1', isDraft: false },
  { number: 2, title: 'beta 추가', assignees: [], author: { login: 'u2' }, headRefName: 'feat/beta', updatedAt: '2026-10-23T02:00:00Z', url: 'https://example.test/pr/2', isDraft: true },
]);
const PR_FILES = JSON.stringify({
  changedFiles: 6,
  files: [
    { path: 'wiki/alpha.md' },
    { path: 'wiki/없는문서.md' },
    { path: 'outputs/a.html' },
    { path: '../밖.md' },
    { path: 'private/p.md' },
    { path: 'outputs/local.md' },
  ],
});

/** args 를 보고 분기하는 스텁. calls 에 호출을 쌓는다. */
function stub(table: Record<string, GhResult>, calls: string[] = []): { gh: GhRunner; calls: string[] } {
  const gh: GhRunner = async (args) => {
    const key = args.join(' ');
    calls.push(key);
    const hit = Object.entries(table).find(([k]) => key.startsWith(k));
    return hit ? hit[1] : bad(`no stub for ${key}`);
  };
  return { gh, calls };
}

describe('reasonOf', () => {
  it('ENOENT → gh 없음', () => {
    const err = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
    assert.equal(reasonOf({ stdout: '', stderr: '', status: null, error: err }), 'gh 없음');
  });
  it('stderr 에 gh auth login → gh 미인증', () => {
    assert.equal(reasonOf(bad('To get started with GitHub CLI, please run:  gh auth login\n', 4)), 'gh 미인증');
  });
  it('타임아웃 → 시간 초과', () => {
    const err = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    assert.equal(reasonOf({ stdout: '', stderr: '', status: null, error: err }), '시간 초과');
    assert.equal(reasonOf({ stdout: '', stderr: '', status: null, signal: 'SIGTERM' }), '시간 초과');
  });
  it('그 밖은 gh 실패: stderr 첫 줄(없으면 종료 코드)', () => {
    assert.equal(reasonOf(bad('GraphQL: Could not resolve to a Repository\nmore', 1)), 'gh 실패: GraphQL: Could not resolve to a Repository');
    assert.equal(reasonOf(bad('', 2)), 'gh 실패: exit 2');
  });
});

describe('parseRepos·isRepoName', () => {
  it('형식: owner/name 만', () => {
    assert.equal(isRepoName('org/vault'), true);
    assert.equal(isRepoName('o.r-g_1/v.a-u_lt'), true);
    assert.equal(isRepoName('-x/y'), false);
    assert.equal(isRepoName('a'), false);
    assert.equal(isRepoName('a/b/c'), false);
    assert.equal(isRepoName('a/ b'), false);
  });
  it('CLI 가 있으면 env 무시, 없으면 env(쉼표·공백), 형식 틀리면 throw', () => {
    assert.deepEqual(parseRepos(['org/a', 'org/b'], 'org/c'), ['org/a', 'org/b']);
    assert.deepEqual(parseRepos([], 'org/c, org/d'), ['org/c', 'org/d']);
    assert.deepEqual(parseRepos([], undefined), []);
    assert.deepEqual(parseRepos([], ''), []);
    assert.throws(() => parseRepos(['-x/y'], undefined), /레포 이름/);
    assert.throws(() => parseRepos([], 'a'), /레포 이름/);
  });
});

describe('parsePrList·parsePrFiles', () => {
  it('목록: 로그인만 뽑고 updatedAt 내림차순', () => {
    const r = parsePrList(PR_LIST);
    assert.ok('prs' in r);
    assert.deepEqual(
      r.prs.map((p) => [p.number, p.assignees, p.author, p.isDraft]),
      [
        [2, [], 'u2', true],
        [1, ['u1'], 'u1', false],
      ],
    );
  });
  it('목록: JSON 아님·배열 아님 → error', () => {
    assert.deepEqual(parsePrList('warning\n[]'), { error: 'gh 실패: 응답이 JSON 이 아니다' });
    assert.deepEqual(parsePrList('{}'), { error: 'gh 실패: 응답이 JSON 이 아니다' });
  });
  it('파일: paths 와 changedFiles', () => {
    assert.deepEqual(parsePrFiles(PR_FILES), {
      paths: ['wiki/alpha.md', 'wiki/없는문서.md', 'outputs/a.html', '../밖.md', 'private/p.md', 'outputs/local.md'],
      changedFiles: 6,
    });
    assert.deepEqual(parsePrFiles('nope'), { error: 'gh 실패: 응답이 JSON 이 아니다' });
  });
});

describe('PrSource', () => {
  let fx: ReturnType<typeof makeFixtureVault>;
  let now: number;
  const clock = () => now;
  beforeEach(() => {
    fx = makeFixtureVault();
    now = 1_000_000;
  });
  afterEach(() => fx.cleanup());

  const make = (gh: GhRunner, repos: string[] = ['org/vault']) =>
    new PrSource({ root: fx.root, includePrivate: false, repos, gh, now: clock });

  it('list: gh pr list 를 --repo·--state open·--limit 100·--json 필드로 부른다', async () => {
    const { gh, calls } = stub({ 'pr list': ok(PR_LIST) });
    const r = await make(gh).list(null);
    assert.equal(r.error, null);
    assert.equal(r.repo, 'org/vault');
    assert.deepEqual(r.prs.map((p) => p.number), [2, 1]);
    assert.equal(r.truncated, false);
    assert.equal(calls.length, 1);
    const args = calls[0]!.split(' ');
    assert.equal(args[0], 'pr');
    assert.equal(args[1], 'list');
    assert.ok(args.includes('--repo') && args[args.indexOf('--repo') + 1] === 'org/vault');
    assert.ok(args.includes('--state') && args[args.indexOf('--state') + 1] === 'open');
    assert.ok(args.includes('--limit') && args[args.indexOf('--limit') + 1] === '100');
    assert.equal(args[args.indexOf('--json') + 1], 'number,title,assignees,author,headRefName,updatedAt,url,isDraft');
  });

  it('list: 100개면 truncated', async () => {
    const many = JSON.stringify(
      Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: `t${i}`, assignees: [], author: { login: 'u' }, headRefName: 'b', updatedAt: '2026-01-01T00:00:00Z', url: 'https://example.test', isDraft: false })),
    );
    const r = await make(stub({ 'pr list': ok(many) }).gh).list(null);
    assert.equal(r.truncated, true);
  });

  it('list: 실패는 error 와 빈 목록, 30초 안에는 spawn 하지 않는다(실패도 캐시)', async () => {
    const { gh, calls } = stub({ 'pr list': bad('To get started with GitHub CLI, please run:  gh auth login', 4) });
    const src = make(gh);
    assert.deepEqual((await src.list(null)).error, 'gh 미인증');
    assert.deepEqual((await src.list(null)).prs, []);
    assert.equal(calls.length, 1);
    now += 29_000;
    await src.list(null);
    assert.equal(calls.length, 1);
    now += 2_000;
    await src.list(null);
    assert.equal(calls.length, 2);
  });

  it('list: JSON 아님 → gh 실패', async () => {
    const r = await make(stub({ 'pr list': ok('not json') }).gh).list(null);
    assert.equal(r.error, 'gh 실패: 응답이 JSON 이 아니다');
    assert.deepEqual(r.prs, []);
  });

  it('list: refresh 는 캐시를 건너뛰고 갈아 끼운다', async () => {
    const { gh, calls } = stub({ 'pr list': ok(PR_LIST) });
    const src = make(gh);
    await src.list(null);
    await src.list(null, true);
    assert.equal(calls.length, 2);
    await src.list(null);
    assert.equal(calls.length, 2);
  });

  it('list: 허용 목록 밖 레포는 error 400 성격의 메시지 없이 — 호출자(라우트)가 막는다; 여기서는 목록 밖이면 throw', async () => {
    const src = make(stub({ 'pr list': ok(PR_LIST) }).gh);
    await assert.rejects(src.list('org/nope'), /허용되지 않은 레포/);
  });

  it('files: 볼트 레포면 md 이고 체크아웃에 있고 범위 안인 것만 viewable', async () => {
    // 볼트 레포는 gh repo view 로만 안다. 그래서 스텁에 넣는다.
    const { gh, calls } = stub({ 'repo view': ok(JSON.stringify({ nameWithOwner: 'org/vault' })), 'pr view 1': ok(PR_FILES) });
    const r = await make(gh).files(null, 1);
    calls.shift(); // repo view
    assert.equal(r.error, null);
    assert.equal(r.number, 1);
    assert.deepEqual(r.files, [
      { path: 'wiki/alpha.md', md: true, viewable: true },
      { path: 'wiki/없는문서.md', md: true, viewable: false },
      { path: 'outputs/a.html', md: false, viewable: false },
      { path: '../밖.md', md: true, viewable: false },
      { path: 'private/p.md', md: true, viewable: false },
      { path: 'outputs/local.md', md: true, viewable: true },
    ]);
    assert.equal(r.truncated, false);
    const args = calls[0]!.split(' ');
    assert.deepEqual(args.slice(0, 3), ['pr', 'view', '1']);
    assert.ok(args.includes('--repo'));
    assert.equal(args[args.indexOf('--json') + 1], 'files,changedFiles');
  });

  it('files: changedFiles 보다 적으면 truncated', async () => {
    const body = JSON.stringify({ changedFiles: 3, files: [{ path: 'wiki/alpha.md' }] });
    const r = await make(stub({ 'pr view 7': ok(body) }).gh).files(null, 7);
    assert.equal(r.truncated, true);
  });

  it('files: 다른 레포는 전부 viewable false', async () => {
    // 허용 목록이 둘이고 볼트 레포는 gh repo view 가 정한다.
    const { gh } = stub({ 'repo view': ok(JSON.stringify({ nameWithOwner: 'org/vault' })), 'pr view 1': ok(PR_FILES) });
    const r = await make(gh, ['org/vault', 'org/other']).files('org/other', 1);
    assert.equal(r.repo, 'org/other');
    assert.ok(r.files.length > 0);
    assert.ok(r.files.every((f) => f.viewable === false));
  });

  it('files: 캐시는 (레포, 번호) 마다', async () => {
    const { gh, calls } = stub({ 'pr view': ok(PR_FILES) });
    const src = make(gh);
    await src.files(null, 1);
    await src.files(null, 2);
    await src.files(null, 1);
    assert.equal(calls.filter((c) => c.startsWith('pr view')).length, 2);
  });

  it('repos: 목록이 비면 gh repo view 로 볼트 레포 하나, 성공은 영구 캐시', async () => {
    const { gh, calls } = stub({ 'repo view': ok(JSON.stringify({ nameWithOwner: 'org/vault' })) });
    const src = make(gh, []);
    assert.deepEqual(await src.repos(), { repos: ['org/vault'], vaultRepo: 'org/vault', error: null });
    now += 100_000;
    await src.repos();
    assert.equal(calls.length, 1);
  });

  it('repos: 실패하면 레포를 못 찾았다, refresh 전엔 재시도 안 함', async () => {
    const { gh, calls } = stub({ 'repo view': bad('none of the git remotes configured for this repository point to a known GitHub host\n') });
    const src = make(gh, []);
    const r = await src.repos();
    assert.deepEqual(r, { repos: [], vaultRepo: null, error: '레포를 못 찾았다: none of the git remotes configured for this repository point to a known GitHub host' });
    await src.repos();
    assert.equal(calls.length, 1);
    await src.repos(true);
    assert.equal(calls.length, 2);
    // list 도 같은 사유를 돌려주고 spawn 하지 않는다.
    const l = await src.list(null);
    assert.equal(l.error, r.error);
    assert.equal(l.repo, null);
    assert.equal(calls.length, 2);
  });

  it('repos: gh repo view 가 미인증으로 실패하면 사유는 gh 미인증(레포를 못 찾았다 가 아니다)', async () => {
    const { gh } = stub({ 'repo view': bad('To get started with GitHub CLI, please run:  gh auth login\n', 4) });
    const src = make(gh, []);
    assert.equal((await src.repos()).error, 'gh 미인증');
    assert.equal((await src.list(null)).error, 'gh 미인증');
  });

  it('files: 볼트 밖을 가리키는 심링크(파일·폴더)는 viewable false', async () => {
    const outside = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kv-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.md'), '# 밖\n');
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(fx.root, 'wiki', 'link-file.md'));
    fs.symlinkSync(outside, path.join(fx.root, 'wiki', 'link-dir'));
    try {
      const body = JSON.stringify({ changedFiles: 3, files: [{ path: 'wiki/link-file.md' }, { path: 'wiki/link-dir/secret.md' }, { path: 'wiki/alpha.md' }] });
      const { gh } = stub({ 'repo view': ok(JSON.stringify({ nameWithOwner: 'org/vault' })), 'pr view 3': ok(body) });
      const r = await make(gh).files(null, 3);
      assert.deepEqual(r.files.map((f) => [f.path, f.viewable]), [
        ['wiki/link-file.md', false],
        ['wiki/link-dir/secret.md', false],
        ['wiki/alpha.md', true],
      ]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('list·files: gh 가 빈 stdout 을 내면 gh 실패', async () => {
    const src = make(stub({ 'pr list': ok(''), 'pr view 1': ok('') }).gh);
    assert.equal((await src.list(null)).error, 'gh 실패: 응답이 JSON 이 아니다');
    assert.equal((await src.files(null, 1)).error, 'gh 실패: 응답이 JSON 이 아니다');
  });

  it('repos: 명시 목록이 있으면 그대로이고 볼트 레포는 gh repo view 로 안다(실패해도 error 없음)', async () => {
    const { gh } = stub({ 'repo view': bad('x') });
    const r = await make(gh, ['org/other']).repos();
    assert.deepEqual(r, { repos: ['org/other'], vaultRepo: null, error: null });
  });
});

describe('makeSpawnRunner', () => {
  it('없는 실행 파일 → error.code ENOENT, 사유 gh 없음', async () => {
    const run = makeSpawnRunner('definitely-not-a-binary-kv-test');
    const r = await run(['pr', 'list'], process.cwd());
    assert.equal(r.error?.code, 'ENOENT');
    assert.equal(reasonOf(r), 'gh 없음');
  });
  it('있는 실행 파일 → stdout 과 status 0', async () => {
    const run = makeSpawnRunner('echo');
    const r = await run(['hello'], process.cwd());
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), 'hello');
  });
});

// ---- HTTP 배선 (Task 3) ----
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createViewerServer, parseArgs } from '../../server/main.ts';

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

describe('/api/panels/prs HTTP', () => {
  let fx: ReturnType<typeof makeFixtureVault>;
  let distTmp: string;
  let server: http.Server;
  let base: string;
  let calls: string[];

  beforeEach(async () => {
    fx = makeFixtureVault();
    distTmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'kv-dist-'));
    const s = stub({ 'repo view': ok(JSON.stringify({ nameWithOwner: 'org/vault' })), 'pr list': ok(PR_LIST), 'pr view 1': ok(PR_FILES) });
    calls = s.calls;
    server = createViewerServer({ root: fx.root, includePrivate: false, distDir: path.join(distTmp, 'dist'), watch: false, prRepos: ['org/vault'], gh: s.gh });
    base = await listen(server);
  });
  afterEach(async () => {
    await close(server);
    fx.cleanup();
    fs.rmSync(distTmp, { recursive: true, force: true });
  });

  const get = async (p: string, headers: Record<string, string> = {}) => {
    const res = await fetch(base + p, { headers });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = { _text: text };
    }
    return { res, json };
  };

  it('/api/panels/prs: 200, prs 배열, Cache-Control no-cache', async () => {
    const { res, json } = await get('/api/panels/prs');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    assert.equal(json.repo, 'org/vault');
    assert.deepEqual((json.prs as Pr[]).map((p) => p.number), [2, 1]);
    assert.equal(json.error, null);
  });

  it('/api/panels/prs/repos: 허용 목록과 볼트 레포', async () => {
    const { res, json } = await get('/api/panels/prs/repos');
    assert.equal(res.status, 200);
    assert.deepEqual(json, { repos: ['org/vault'], vaultRepo: 'org/vault', error: null });
  });

  it('/api/panels/prs?repo=org/nope: 400', async () => {
    const { res, json } = await get('/api/panels/prs?repo=org%2Fnope');
    assert.equal(res.status, 400);
    assert.match(String(json.error), /허용되지 않은 레포/);
  });

  it('/api/panels/prs/files: number 가 정수가 아니면 400 이고 러너를 부르지 않는다', async () => {
    for (const n of ['12abc', '-1', '1e3', '', '0x10']) {
      const { res } = await get(`/api/panels/prs/files?number=${encodeURIComponent(n)}`);
      assert.equal(res.status, 400, n);
    }
    const { res } = await get('/api/panels/prs/files');
    assert.equal(res.status, 400);
    assert.equal(calls.filter((c) => c.startsWith('pr view')).length, 0);
  });

  it('/api/panels/prs/files?number=1: viewable 이 fixture 와 맞다', async () => {
    const { res, json } = await get('/api/panels/prs/files?number=1');
    assert.equal(res.status, 200);
    assert.equal(json.number, 1);
    const files = json.files as PrFile[];
    assert.deepEqual(files.filter((f) => f.viewable).map((f) => f.path), ['wiki/alpha.md', 'outputs/local.md']);
  });

  it('/api/panels/prs?refresh=1: 다시 spawn 한다', async () => {
    await get('/api/panels/prs');
    await get('/api/panels/prs');
    assert.equal(calls.filter((c) => c.startsWith('pr list')).length, 1);
    await get('/api/panels/prs?refresh=1');
    assert.equal(calls.filter((c) => c.startsWith('pr list')).length, 2);
  });

  it('/api/panels/prs: 다른 Origin 403, localhost 호스트 404', async () => {
    const a = await get('/api/panels/prs', { Origin: 'http://evil.test' });
    assert.equal(a.res.status, 403);
    // fetch 는 Host 를 못 바꾼다. node:http 로 Host 만 localhost 로 보낸다.
    const status = await new Promise<number>((resolve, reject) => {
      const u = new URL(base);
      const req = http.request({ host: '127.0.0.1', port: u.port, path: '/api/panels/prs', headers: { Host: `localhost:${u.port}` } }, (r) => {
        r.resume();
        r.on('end', () => resolve(r.statusCode ?? 0));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 404);
  });

  it('/api/panels/nope: 404', async () => {
    const { res } = await get('/api/panels/nope');
    assert.equal(res.status, 404);
  });
});

describe('parseArgs --pr-repo', () => {
  it('두 번 → 둘, 없으면 env, 형식 틀리면 throw', () => {
    assert.deepEqual(parseArgs(['--pr-repo', 'org/a', '--pr-repo', 'org/b'], { KNOWLEDGE_VIEWER_PR_REPOS: 'org/c' }).prRepos, ['org/a', 'org/b']);
    assert.deepEqual(parseArgs([], { KNOWLEDGE_VIEWER_PR_REPOS: 'org/c,org/d' }).prRepos, ['org/c', 'org/d']);
    assert.deepEqual(parseArgs([], {}).prRepos, []);
    assert.throws(() => parseArgs(['--pr-repo', '-x/y'], {}), /레포 이름/);
  });
});
