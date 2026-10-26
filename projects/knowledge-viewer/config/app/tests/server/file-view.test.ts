// /api/file — 텍스트 파일 보기의 데이터. local·git 소스, 경계(private·조각 규칙), 바이너리, 상한(truncated), PR hunk.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { decodeText, FILE_VIEW_LIMIT } from '../../server/file-view.ts';
import { createViewerServer } from '../../server/main.ts';
import { SourceManager } from '../../server/source.ts';
import { makeGitFixture, type GitFixture } from '../helpers/git-fixture.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TEN = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n') + '\n';
// 3번 줄을 고치고, 5번 줄을 지우고, 8번 줄을 고친다.
const PR_TEN = ['line1', 'line2', 'LINE3', 'line4', 'line6', 'line7', 'LINE8', 'line9', 'line10'].join('\n') + '\n';

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

describe('/api/file', () => {
  let fx: GitFixture;
  let distTmp: string;
  const servers: http.Server[] = [];
  let base: string;
  let basePrivate: string;

  before(async () => {
    fx = makeGitFixture();
    fx.commitOnMaster({ 'projects/demo/app.ts': TEN }, 'app');
    fx.openPr(7, 'master', { 'projects/demo/app.ts': PR_TEN, 'projects/demo/new.yml': 'a: 1\n', 'projects/demo/blob.bin': 'x\0y' }, 'PR 7');
    // 디스크에만 있는 파일들(추적하지 않는다).
    fs.writeFileSync(path.join(fx.root, 'projects', 'demo', 'tool.py'), 'print("안녕")\r\nx = 1\n');
    fs.writeFileSync(path.join(fx.root, 'projects', 'demo', 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    fs.writeFileSync(path.join(fx.root, 'projects', 'demo', 'latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    fs.writeFileSync(path.join(fx.root, 'projects', 'demo', 'big.txt'), '가'.repeat(200_000));
    fs.writeFileSync(path.join(fx.root, 'private', 'secret.ts'), 'export const s = 1;\n');
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

  const get = async (p: string, at = base): Promise<{ status: number; type: string; json: Json }> => {
    const res = await fetch(at + p);
    return { status: res.status, type: res.headers.get('content-type') ?? '', json: (await res.json()) as Json };
  };

  it('local: 디스크 파일을 JSON 텍스트로 준다(\\r\\n 그대로, 크기는 바이트)', async () => {
    const { status, type, json } = await get('/api/file?path=projects/demo/tool.py');
    assert.equal(status, 200);
    assert.match(type, /^application\/json/);
    assert.equal(json.path, 'projects/demo/tool.py');
    assert.equal(json.text, 'print("안녕")\r\nx = 1\n');
    assert.equal(json.size, Buffer.byteLength(json.text));
    assert.equal(json.binary, false);
    assert.equal(json.truncated, false);
    assert.equal('change' in json, false);
  });

  it('git 소스: main 은 master 내용, pr 은 PR 내용 + hunk·지운 자리', async () => {
    const main = await get('/api/file?path=projects/demo/app.ts&src=main');
    assert.equal(main.status, 200);
    assert.equal(main.json.text, TEN);
    assert.equal('change' in main.json, false);
    const pr = await get('/api/file?path=projects/demo/app.ts&src=pr:7');
    assert.equal(pr.status, 200);
    assert.equal(pr.json.text, PR_TEN);
    assert.deepEqual(pr.json.change, {
      status: 'M',
      hunks: [
        { start: 3, end: 3 },
        { start: 7, end: 7 },
      ],
      removed: [{ afterLine: 4, count: 1 }],
      added: 2,
      deleted: 3,
    });
    const added = await get('/api/file?path=projects/demo/new.yml&src=pr:7');
    assert.equal(added.json.text, 'a: 1\n');
    assert.equal(added.json.change.status, 'A');
    assert.deepEqual(added.json.change.hunks, [{ start: 1, end: 1 }]);
    // PR 이 안 바꾼 파일은 status null.
    const same = await get('/api/file?path=wiki/beta.md&src=pr:7');
    assert.equal(same.status, 200);
    assert.equal(same.json.change.status, null);
  });

  it('PR 에만 있는 파일은 local 404, 디스크에만 있는 파일은 git 소스 404', async () => {
    assert.equal((await get('/api/file?path=projects/demo/new.yml')).status, 404);
    assert.equal((await get('/api/file?path=projects/demo/tool.py&src=pr:7')).status, 404);
  });

  it('바이너리: NUL·UTF-8 불가면 binary 이고 본문은 비운다', async () => {
    for (const q of ['projects/demo/pic.png', 'projects/demo/latin1.txt', 'projects/demo/blob.bin&src=pr:7']) {
      const { status, json } = await get(`/api/file?path=${q}`);
      assert.equal(status, 200, q);
      assert.equal(json.binary, true, q);
      assert.equal(json.text, '', q);
    }
  });

  it('상한을 넘으면 앞부분만(여러 바이트 글자를 끊지 않는다) + truncated', async () => {
    const { json } = await get('/api/file?path=projects/demo/big.txt');
    assert.equal(json.truncated, true);
    assert.equal(json.binary, false);
    assert.equal(json.size, 600_000);
    const bytes = Buffer.byteLength(json.text);
    assert.ok(bytes <= FILE_VIEW_LIMIT && bytes > FILE_VIEW_LIMIT - 4, String(bytes));
    assert.match(json.text, /^가+$/);
  });

  it('경계: private 는 includePrivate 서버의 local 에서만, git 소스·조각 규칙은 /api/doc 과 같다', async () => {
    assert.equal((await get('/api/file?path=private/secret.ts')).status, 404);
    assert.equal((await get('/api/file?path=private/secret.ts', basePrivate)).status, 200);
    for (const src of ['main', 'pr:7']) assert.equal((await get(`/api/file?path=private/secret.ts&src=${src}`, basePrivate)).status, 404, src);
    for (const q of ['', '../x.ts', '/etc/passwd', 'PRIVATE/secret.ts', '.git/config', 'node_modules/x.md', 'wiki/a%00.ts', 'projects/demo']) {
      assert.equal((await get(`/api/file?path=${q}`)).status, 404, q);
    }
    assert.equal((await get('/api/file?path=projects/demo/app.ts&src=nope')).status, 400);
  });

  it('decodeText: BOM 은 떼고, 상한 경계의 이어지는 바이트를 물린다', () => {
    assert.deepEqual(decodeText(Buffer.from('﻿a'), 4), { text: 'a', truncated: false, binary: false });
    // "a가" = 61 ea b0 80. 상한 2 면 "가" 가운데서 끊기므로 "a" 만.
    const b = Buffer.from('a가');
    assert.deepEqual(decodeText(b, b.length, 2), { text: 'a', truncated: true, binary: false });
  });
});
