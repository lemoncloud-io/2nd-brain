// 뷰어 모음 등록부 빌더: 등록 레이어 훑기·viewer 블록 검사·순서·결정성·CLI(--check)·이 볼트의 등록부 최신 여부.
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collectViewers, renderRegistry, SKILLS_DIR } from '../../server/panels/viewers-build.ts';
import { parseRegistry, REGISTRY_PATH } from '../../server/panels/viewers.ts';
import { runViewersBuild } from '../../viewers-build.ts';
import { findVaultRoot } from '../../shared/vault.ts';

function write(root: string, rel: string, body: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}
/** projects/<p>/config/skills/<s>/SKILL.md 를 쓰고 등록 레이어에 상대 심링크로 건다. */
function skill(root: string, p: string, s: string, front: string, register = true): string {
  const rel = `projects/${p}/config/skills/${s}`;
  write(root, `${rel}/SKILL.md`, `---\nname: ${s}\ndescription: 합성 스킬\n${front}---\n\n본문\n`);
  if (register) {
    fs.mkdirSync(path.join(root, SKILLS_DIR), { recursive: true });
    fs.symlinkSync(`../../${rel}`, path.join(root, SKILLS_DIR, s));
  }
  return `${rel}/SKILL.md`;
}
const staticBlock = (id: string, order?: number) =>
  `viewer:\n  id: ${id}\n${order === undefined ? '' : `  order: ${order}\n`}  title: ${id} 보기\n  description: ${id} 설명\n  open:\n    kind: static\n    path: projects/${id}/outputs/site/index.html\n`;

describe('collectViewers', () => {
  let root: string;
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kv-viewers-build-')));
    write(root, 'VAULT_RULES.md', '---\ntype: rules\n---\n');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('등록된 스킬 중 viewer 블록이 있는 것만, order 다음 id 순으로', () => {
    const b = skill(root, 'b', 'b-view', staticBlock('beta', 20));
    const a = skill(root, 'a', 'a-view', staticBlock('alpha', 20));
    skill(root, 'c', 'c-view', staticBlock('gamma', 10));
    skill(root, 'd', 'd-tool', '');
    skill(root, 'e', 'e-view', staticBlock('unregistered'), false);
    const r = collectViewers(root);
    assert.deepEqual(r.entries.map((e) => e.id), ['gamma', 'alpha', 'beta']);
    assert.equal(r.entries[1].skill, a);
    assert.equal(r.entries[2].skill, b);
    assert.deepEqual([r.scanned, r.skipped, r.problems.length], [4, 1, 0]);
    assert.ok(!r.entries.some((e) => e.id === 'unregistered'), '등록 레이어에 없는 스킬은 이 볼트의 뷰어가 아니다');
  });

  it('틀린 viewer 블록·겹친 id·볼트 밖·끊긴 심링크는 빼고 사유를 남긴다', () => {
    skill(root, 'a', 'a-view', staticBlock('alpha'));
    skill(root, 'b', 'b-view', 'viewer:\n  id: Bad Id\n  title: x\n  description: y\n  open:\n    kind: static\n    path: a.html\n');
    skill(root, 'c', 'c-view', staticBlock('alpha'));
    skill(root, 'd', 'd-view', 'viewer:\n  id: delta\n  title: d\n  description: d\n  open:\n    kind: server\n    url: https://example.com/\n    port: 443\n    ask: 열어줘\n');
    skill(root, 'e', 'e-view', 'viewer: 문자열\n');
    skill(root, 'f', 'f-view', 'viewer:\n  id: phi\n  order: 1.5\n  title: f\n  description: f\n  open:\n    kind: project-viewers\n');
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kv-outside-')));
    write(outside, 'SKILL.md', `---\nname: x\n${staticBlock('outside')}---\n`);
    fs.symlinkSync(outside, path.join(root, SKILLS_DIR, 'g-outside'));
    fs.symlinkSync('../../projects/nowhere', path.join(root, SKILLS_DIR, 'h-broken'));
    try {
      const r = collectViewers(root);
      assert.deepEqual(r.entries.map((e) => e.id), ['alpha']);
      const reasons = r.problems.map((p) => `${p.skill.split('/').at(-2) ?? p.skill} ${p.reason}`).join('\n');
      assert.match(reasons, /b-view viewer\(Bad Id\): id 는 소문자/);
      assert.match(reasons, /c-view viewer\.id\(alpha\)가 다른 스킬과 겹친다/);
      assert.match(reasons, /d-view .*open\.url 은 http:\/\/127\.0\.0\.1/);
      assert.match(reasons, /e-view viewer 는 객체여야 한다/);
      assert.match(reasons, /f-view viewer\.order 는 정수다/);
      assert.match(reasons, /볼트 밖을 가리킨다/);
      assert.match(reasons, /끊긴 심링크/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('등록 레이어가 없으면 빈 등록부, 렌더는 결정적이고 서버 파서가 그대로 읽는다', () => {
    assert.deepEqual(collectViewers(root), { entries: [], scanned: 0, skipped: 0, problems: [] });
    skill(root, 'a', 'a-view', staticBlock('alpha'));
    skill(root, 'k', 'k-view', 'viewer:\n  id: kv\n  title: 볼트 뷰어\n  description: d\n  open:\n    kind: server\n    url: http://127.0.0.1:8778/\n    port: 8778\n    launch: knowledge-viewer\n    ask: 열어줘\n');
    const text = renderRegistry(collectViewers(root).entries);
    assert.equal(text, renderRegistry(collectViewers(root).entries));
    assert.ok(text.startsWith('# 뷰어 모음 패널 등록부 — 생성 파일'));
    const parsed = parseRegistry(text);
    assert.equal(parsed.error, null);
    assert.deepEqual(parsed.entries.map((e) => [e.id, e.open.kind]), [['alpha', 'static'], ['kv', 'server']]);
    assert.ok(!/\bnull\b/.test(text), '파서 기본값(null)을 등록부에 싣지 않는다');
  });

  it('CLI: 쓰고, 같으면 다시 쓰지 않고, --check 는 다를 때 1', () => {
    skill(root, 'a', 'a-view', staticBlock('alpha'));
    const lines: string[] = [];
    const out = (l: string) => lines.push(l);
    assert.equal(runViewersBuild(['--check', '--root', root], out, out), 1);
    assert.ok(!fs.existsSync(path.join(root, REGISTRY_PATH)), '--check 는 쓰지 않는다');
    assert.equal(runViewersBuild(['--root', root], out, out), 0);
    const first = fs.statSync(path.join(root, REGISTRY_PATH)).mtimeMs;
    assert.equal(runViewersBuild(['--root', root], out, out), 0);
    assert.equal(fs.statSync(path.join(root, REGISTRY_PATH)).mtimeMs, first);
    assert.equal(runViewersBuild(['--check', '--root', root], out, out), 0);
    skill(root, 'b', 'b-view', staticBlock('beta'));
    assert.equal(runViewersBuild(['--check', '--root', root], out, out), 1);
    assert.equal(runViewersBuild(['--bogus'], out, out), 2);
  });
});

describe('이 볼트의 등록부', () => {
  it('스킬의 viewer 블록에서 만든 결과와 같다(viewers-build --check)', () => {
    const root = findVaultRoot(import.meta.dirname);
    const file = path.join(root, REGISTRY_PATH);
    assert.ok(fs.existsSync(file), `${REGISTRY_PATH} 가 없다 — npm run viewers-build`);
    assert.equal(fs.readFileSync(file, 'utf8'), renderRegistry(collectViewers(root).entries), '스킬과 등록부가 다르다 — npm run viewers-build');
  });
});
