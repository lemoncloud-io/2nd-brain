// 뷰어 모음 패널 서버: 등록부 파싱·static 존재 판정·server 핑·project-viewers 펼치기·캐시·라우트.
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { handlePanels } from '../../server/panels/routes.ts';
import { PrSource } from '../../server/panels/prs.ts';
import { REGISTRY_PATH, ViewersSource, parseRegistry, tcpPing, type Pinger } from '../../server/panels/viewers.ts';

const SKILL = 'projects/demo/config/skills/demo-view/SKILL.md';

function write(root: string, rel: string, body: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

const entry = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'demo',
  title: '데모 보기',
  description: '데모 사이트',
  skill: SKILL,
  open: { kind: 'static', path: 'projects/demo/outputs/site/index.html' },
  ...over,
});
const yml = (viewers: unknown[]): string => JSON.stringify({ schema_version: 1, viewers }); // JSON 은 YAML 이다

describe('parseRegistry', () => {
  it('세 종류를 읽는다', () => {
    const r = parseRegistry(
      yml([
        entry(),
        entry({ id: 'srv', open: { kind: 'server', url: 'http://127.0.0.1:9000/?agent=claude', port: 9000, launch: 'srv-x', ask: '서버 켜줘' } }),
        entry({ id: 'man', open: { kind: 'server', ask: '앱 시작' } }),
        entry({ id: 'pv', open: { kind: 'project-viewers' } }),
      ]),
    );
    assert.equal(r.error, null);
    assert.deepEqual(r.entries.map((e) => e.open.kind), ['static', 'server', 'server', 'project-viewers']);
    assert.deepEqual(r.entries[1]!.open, { kind: 'server', url: 'http://127.0.0.1:9000/?agent=claude', port: 9000, launch: 'srv-x', ask: '서버 켜줘' });
    assert.deepEqual(r.entries[2]!.open, { kind: 'server', url: null, port: null, launch: null, ask: '앱 시작' });
  });

  it('필수 필드가 빠지면 그 항목을 빼고 오류 한 줄', () => {
    const { description: _d, ...noDesc } = entry({ id: 'b' });
    const r = parseRegistry(yml([entry(), noDesc]));
    assert.deepEqual(r.entries.map((e) => e.id), ['demo']);
    assert.equal(r.error, 'viewers.yml: 2번째 항목(b)에 description 이 없다');
    assert.ok(!r.error!.includes('\n'));
  });

  it('여러 건이면 첫 사유 + 외 n건', () => {
    const r = parseRegistry(yml([{ title: 'x' }, entry({ skill: 'a.md' }), entry({ open: { kind: 'server' } })]));
    assert.equal(r.entries.length, 0);
    assert.equal(r.error, 'viewers.yml: 1번째 항목에 id 가 없다 외 2건');
  });

  it('바깥 주소·스크립트 주소·포트 불일치·경로 탈출을 거절한다', () => {
    const bad = [
      { kind: 'server', url: 'https://example.com/', port: 443, ask: 'a' },
      { kind: 'server', url: 'javascript:alert(1)', port: 80, ask: 'a' },
      { kind: 'server', url: 'http://127.0.0.1:9001/', port: 9000, ask: 'a' },
      { kind: 'server', url: 'http://127.0.0.1:9000/', ask: 'a' },
      { kind: 'static', path: '../outside.html' },
      { kind: 'static', path: '/abs/index.html' },
      { kind: 'static', path: 'projects/demo/readme.md' },
      { kind: 'nope' },
    ];
    for (const open of bad) {
      const r = parseRegistry(yml([entry({ open })]));
      assert.equal(r.entries.length, 0, JSON.stringify(open));
      assert.match(r.error ?? '', /^viewers\.yml: 1번째 항목\(demo\)/);
    }
  });

  it('id 가 겹치면 뒤 것을 뺀다', () => {
    const r = parseRegistry(yml([entry(), entry()]));
    assert.equal(r.entries.length, 1);
    assert.match(r.error ?? '', /id 가 겹친다/);
  });

  it('YAML 이 깨지거나 목록이 없으면 오류 한 줄', () => {
    assert.match(parseRegistry('viewers: [').error ?? '', /^viewers\.yml 을 읽지 못했다: /);
    assert.equal(parseRegistry('schema_version: 1').error, 'viewers.yml 에 viewers 목록이 없다');
  });

  it('볼트의 등록부(생성 파일)는 오류 없이 읽히고 경로는 도구 폴더(config/) 밖이다', () => {
    assert.equal(REGISTRY_PATH, 'projects/knowledge-viewer/viewers.yml');
    const real = fs.readFileSync(path.join(import.meta.dirname, '../../../../viewers.yml'), 'utf8');
    const r = parseRegistry(real);
    assert.equal(r.error, null);
    assert.ok(r.entries.length > 0);
  });
});

describe('tcpPing', () => {
  let server: net.Server;
  let port: number;
  beforeEach(async () => {
    server = net.createServer((s) => s.destroy());
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as net.AddressInfo).port;
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it('듣는 포트는 up, 닫힌 포트는 down', async () => {
    assert.equal(await tcpPing(port), true);
    const closed = await new Promise<number>((resolve) => {
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => {
        const p = (s.address() as net.AddressInfo).port;
        s.close(() => resolve(p));
      });
    });
    assert.equal(await tcpPing(closed), false);
  });
});

describe('ViewersSource', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-viewers-'));
    write(root, SKILL, '---\nname: demo-view\n---\n');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const make = (over: { ping?: Pinger; now?: () => number } = {}) => new ViewersSource({ root, includePrivate: false, ...over });

  it('등록부가 없으면 오류 한 줄', async () => {
    const r = await make().list();
    assert.deepEqual(r.viewers, []);
    assert.equal(r.error, `등록부가 없다: ${REGISTRY_PATH} — 볼트에서 npm run viewers-build 로 만든다`);
  });

  it('static: 파일이 있으면 ok, 없으면 missing', async () => {
    write(root, 'projects/demo/outputs/site/index.html', '<!doctype html>');
    write(root, REGISTRY_PATH, yml([entry(), entry({ id: 'gone', open: { kind: 'static', path: 'projects/demo/outputs/none/index.html' } })]));
    const r = await make().list();
    assert.equal(r.error, null);
    assert.deepEqual(r.viewers.map((v) => [v.id, v.status]), [['demo', 'ok'], ['gone', 'missing']]);
  });

  it('static: private/ 는 includePrivate 가 아니면 missing', async () => {
    write(root, 'private/x.html', '<p>');
    write(root, REGISTRY_PATH, yml([entry({ open: { kind: 'static', path: 'private/x.html' } })]));
    assert.equal((await make().list()).viewers[0]!.status, 'missing');
    assert.equal((await new ViewersSource({ root, includePrivate: true }).list()).viewers[0]!.status, 'ok');
  });

  it('server: 실제 핑으로 up·down, 포트 없으면 manual', async () => {
    const srv = net.createServer((s) => s.destroy());
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const up = (srv.address() as net.AddressInfo).port;
    const down = await new Promise<number>((resolve) => {
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => {
        const p = (s.address() as net.AddressInfo).port;
        s.close(() => resolve(p));
      });
    });
    try {
      write(
        root,
        REGISTRY_PATH,
        yml([
          entry({ id: 'on', open: { kind: 'server', url: `http://127.0.0.1:${up}/`, port: up, ask: '켜줘' } }),
          entry({ id: 'off', open: { kind: 'server', url: `http://localhost:${down}/#single`, port: down, launch: 'off', ask: '꺼진 것 켜줘' } }),
          entry({ id: 'man', open: { kind: 'server', ask: '앱 시작' } }),
        ]),
      );
      const r = await make().list();
      assert.deepEqual(r.viewers.map((v) => [v.id, v.status]), [['on', 'up'], ['off', 'down'], ['man', 'manual']]);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  it('project-viewers: 산출물이 있는 프로젝트마다 static 항목으로 펼친다', async () => {
    write(root, 'projects/beta/outputs/viewer/index.html', '<p>');
    write(root, 'projects/beta/config/viewer.yml', 'schema_version: 1\nmeta:\n  title: 베타 뷰어\n  summary: 베타 요약\n');
    write(root, 'projects/alpha/outputs/viewer/index.html', '<p>');
    write(root, 'projects/gamma/README.md', '# 뷰어 없음');
    write(root, REGISTRY_PATH, yml([entry({ id: 'pv', title: '프로젝트 뷰어', open: { kind: 'project-viewers' } })]));
    const r = await make().list();
    assert.equal(r.error, null);
    assert.deepEqual(
      r.viewers.map((v) => ({ id: v.id, title: v.title, description: v.description, status: v.status, group: v.group, open: v.open })),
      [
        { id: 'pv:alpha', title: 'alpha 뷰어', description: '데모 사이트', status: 'ok', group: '프로젝트 뷰어', open: { kind: 'static', path: 'projects/alpha/outputs/viewer/index.html', ask: 'alpha 뷰어 보여줘' } },
        { id: 'pv:beta', title: '베타 뷰어', description: '베타 요약', status: 'ok', group: '프로젝트 뷰어', open: { kind: 'static', path: 'projects/beta/outputs/viewer/index.html', ask: 'beta 뷰어 보여줘' } },
      ],
    );
    assert.ok(r.viewers.every((v) => v.skill === SKILL));
  });

  it('10초 캐시, refresh 는 건너뛴다', async () => {
    let t = 1_000_000;
    let pings = 0;
    const ping: Pinger = async () => {
      pings++;
      return false;
    };
    write(root, REGISTRY_PATH, yml([entry({ id: 's', open: { kind: 'server', url: 'http://127.0.0.1:9/', port: 9, ask: 'a' } })]));
    const src = make({ ping, now: () => t });
    await src.list();
    t += 9_999;
    await src.list();
    assert.equal(pings, 1, '캐시 안');
    await src.list(true);
    assert.equal(pings, 2, 'refresh');
    t += 10_000;
    await src.list();
    assert.equal(pings, 3, '만료');
  });

  it('핑이 거부돼도 down 으로 답한다', async () => {
    write(root, REGISTRY_PATH, yml([entry({ id: 's', open: { kind: 'server', url: 'http://127.0.0.1:9/', port: 9, ask: 'a' } })]));
    const r = await make({ ping: () => Promise.reject(new Error('boom')) }).list();
    assert.equal(r.viewers[0]!.status, 'down');
  });

  it('라우트: /api/panels/viewers 는 200 + 목록, refresh=1 전달, viewers 없으면 404', async () => {
    write(root, REGISTRY_PATH, '{ viewers: [ { id: x } ] }');
    const pr = new PrSource({ root, includePrivate: false, repos: ['org/vault'], gh: async () => ({ stdout: '', stderr: '', status: 1 }) });
    const res = await handlePanels(pr, new URL('http://127.0.0.1/api/panels/viewers?refresh=1'), make());
    assert.equal(res.status, 200);
    assert.equal((res.body as { error: string }).error, 'viewers.yml: 1번째 항목(x)에 title 이 없다');
    const none = await handlePanels(pr, new URL('http://127.0.0.1/api/panels/viewers'));
    assert.equal(none.status, 404);
  });
});
