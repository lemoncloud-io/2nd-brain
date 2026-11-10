// 원본 수집. 파일·git·시계는 전부 주입받으므로 테스트는 실제 git을 부르지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CheckError, collect } from '../../loader/collect.ts';
import { digest12 } from '../../loader/stamp.ts';
import type { GitInfo } from '../../loader/stamp.ts';

const MINI = path.join(import.meta.dirname, '..', 'fixtures', 'mini');
const DEMO = path.join(MINI, 'projects', 'demo');
const GIT: GitInfo = { commit: 'abcd1234', dirty: false };
const NOW = (): Date => new Date('2026-09-19T00:00:00.000Z');

function collectDemo() {
  return collect({ projectDir: DEMO, git: GIT, now: NOW });
}

/** 임시 볼트를 하나 만든다. 프로젝트는 projects/x다. */
function makeVault(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'viewer-collect-'));
  fs.writeFileSync(path.join(dir, 'VAULT_RULES.md'), '# 테스트 볼트\n');
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
  return dir;
}

function viewerYml(sources: string[], blocks: string[]): string {
  return [
    'schema_version: 1',
    'meta:',
    '  title: 임시',
    '  kind: explainer',
    'sources:',
    ...sources.map((s) => `  - ${s}`),
    'pages:',
    '  - id: P1',
    '    title: 개요',
    '    blocks:',
    ...blocks.map((b) => `      ${b}`),
  ].join('\n');
}

// ── 본문과 제목 ──────────────────────────────────────────────────────────────

test('frontmatter를 뗀 본문은 원문 바이트 그대로다', () => {
  const bundle = collectDemo();
  const raw = fs.readFileSync(path.join(DEMO, 'docs', 'overview.md'), 'utf8');
  const expected = raw.slice(raw.indexOf('\n---\n') + '\n---\n'.length);
  assert.ok(expected.startsWith('\n# 데모 서비스 개요'));
  assert.deepEqual(Buffer.from(bundle.docs['overview']!.body), Buffer.from(expected));
  assert.deepEqual(bundle.docs['overview']!.frontmatter, { title: '데모 서비스 개요', status: 'in_progress' });
});

test('제목은 yml의 title → frontmatter → 첫 h1 → 파일 이름 순이다', (t) => {
  const dir = makeVault({
    'projects/x/a.md': '---\ntitle: 머리말 제목\n---\n\n# 본문 제목\n\n한 줄.\n',
    'projects/x/b.md': '# 첫 h1이 제목이다\n\n두 줄.\n',
    'projects/x/c.md': '이름 말고는 단서가 없다.\n',
    'projects/x/config/viewer.yml': viewerYml(
      [
        '{id: a, path: projects/x/a.md, role: primary, kind: doc}',
        '{id: b, path: projects/x/b.md, title: yml이 붙인 이름, role: primary, kind: doc}',
        '{id: c, path: projects/x/c.md, role: primary, kind: doc}',
      ],
      ['- {type: prose, id: B1, text: 한 줄., evidence: [{source: a}]}'],
    ),
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bundle = collect({ projectDir: path.join(dir, 'projects', 'x'), git: GIT, now: NOW });
  assert.equal(bundle.docs['a']!.title, '머리말 제목');
  assert.equal(bundle.docs['b']!.title, 'yml이 붙인 이름');
  assert.equal(bundle.docs['c']!.title, 'c.md');
});

test('code·data 원본은 frontmatter를 떼지 않는다', () => {
  const bundle = collectDemo();
  const raw = fs.readFileSync(path.join(DEMO, 'docs', 'status.yml'), 'utf8');
  const doc = bundle.docs['ledger']!;
  assert.equal(doc.kind, 'data');
  assert.deepEqual(Buffer.from(doc.body), Buffer.from(raw));
  assert.deepEqual(doc.frontmatter, {});
  assert.deepEqual(doc.headings, []);
  assert.equal(doc.embedded, true);
});

// ── 지문 ─────────────────────────────────────────────────────────────────────

test('지문은 파일 전체 기준 sha256 앞 12자다', () => {
  const bundle = collectDemo();
  const raw = fs.readFileSync(path.join(DEMO, 'docs', 'overview.md'), 'utf8');
  assert.equal(bundle.docs['overview']!.digest.length, 12);
  assert.equal(bundle.docs['overview']!.digest, digest12(raw));
  // 본문 기준이 아니라 파일 기준임을 못 박는다.
  assert.notEqual(bundle.docs['overview']!.digest, digest12(bundle.docs['overview']!.body));
  assert.equal(bundle.stamp.ymlDigest, digest12(fs.readFileSync(path.join(DEMO, 'config', 'viewer.yml'), 'utf8')));
  assert.equal(bundle.stamp.ledgerDigest, digest12(fs.readFileSync(path.join(DEMO, 'docs', 'status.yml'), 'utf8')));
});

// ── 헤딩 줄 번호 기준 ────────────────────────────────────────────────────────

test('헤딩 줄 번호는 model의 해소 결과와 같은 파일 기준이다', () => {
  const bundle = collectDemo();
  const flow = bundle.docs['flow']!;
  // flow.md는 frontmatter 3줄 + 빈 줄 뒤 5번째 줄에 h1이 있다(본문 기준이면 2).
  assert.equal(flow.headings[0]!.text, '처리 흐름');
  assert.equal(flow.headings[0]!.line, 5);

  const page = bundle.viewer.pages.find((p) => p.id === 'P-flow')!;
  const mermaid = page.blocks.find((b) => b.id === 'B-mermaid')!;
  const resolved = (mermaid.evidence![0] as unknown as { resolved: { line?: number; slug?: string } }).resolved;
  const picture = flow.headings.find((h) => h.text === '그림')!;
  assert.equal(resolved.line, picture.line);
  assert.equal(resolved.slug, picture.slug);
});

// ── 누락과 저장소 코드 ───────────────────────────────────────────────────────

test('reference 원본이 없으면 missing이고 경고로 집계한다', (t) => {
  const dir = makeVault({
    'projects/x/a.md': '# 있다\n\n한 줄.\n',
    'projects/x/config/viewer.yml': viewerYml(
      [
        '{id: a, path: projects/x/a.md, role: primary, kind: doc}',
        '{id: gone, path: projects/x/없다.md, role: reference, kind: doc}',
      ],
      ['- {type: prose, id: B1, text: 한 줄., evidence: [{source: a}]}'],
    ),
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bundle = collect({ projectDir: path.join(dir, 'projects', 'x'), git: GIT, now: NOW });
  assert.equal(bundle.docs['gone']!.missing, true);
  assert.equal(bundle.docs['gone']!.digest, '');
  assert.equal(bundle.docs['gone']!.body, '');
  assert.equal(bundle.docs['a']!.missing, false);
  assert.equal(bundle.stamp.counts.missingReferences, 1);
  assert.ok(bundle.issues.some((i) => i.code === 'W_REFERENCE_MISSING' && i.level === 'warning'));
  assert.equal(bundle.issues.every((i) => i.level === 'warning'), true);
});

test('repo 원본은 본문을 내장하지 않고 확인 실패를 집계한다', (t) => {
  const dir = makeVault({
    'projects/x/a.md': '# 있다\n\n한 줄.\n',
    'projects/x/config/viewer.yml': viewerYml(
      [
        '{id: a, path: projects/x/a.md, role: primary, kind: doc}',
        '{id: code, path: src/app.ts, role: reference, kind: code, repo: some/repo, commit: deadbeef}',
      ],
      ['- {type: prose, id: B1, text: 한 줄., evidence: [{source: a}, {source: code, lines: "3-9"}]}'],
    ),
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bundle = collect({ projectDir: path.join(dir, 'projects', 'x'), git: GIT, now: NOW });
  const doc = bundle.docs['code']!;
  assert.equal(doc.embedded, false);
  assert.equal(doc.body, '');
  assert.equal(bundle.stamp.counts.unverifiedCode, 1);
  assert.ok(bundle.issues.some((i) => i.code === 'W_CODE_UNVERIFIED'));
});

test('물려받은 근거 수가 스탬프에 남는다', () => {
  const bundle = collectDemo();
  // 그래프 노드 3개가 easy만 갖고 블록 근거를 물려받는다. 경고는 블록마다 1건이므로 count를 더한다.
  assert.equal(
    bundle.stamp.counts.inheritedEvidence,
    bundle.issues.filter((i) => i.code === 'W_INHERITED').reduce((sum, i) => sum + (i.count ?? 1), 0),
  );
  assert.ok(bundle.stamp.counts.inheritedEvidence > 0);
});

// ── 역링크 ───────────────────────────────────────────────────────────────────

test('역링크는 근거를 실제로 건 항목만 센다 — 물려받은 것은 블록 1건이다', () => {
  const bundle = collectDemo();
  assert.deepEqual(
    bundle.backlinks['overview']!.map((b) => `${b.kind}:${b.id}`),
    ['glossary:G-queue', 'glossary:G-retry', 'block:B-graph', 'block:B-tree', 'item:S1.C2', 'block:B-prose'],
  );
  // 노드 N-intake·N-worker·N-store는 easy가 있지만 블록 근거를 물려받았으므로 따로 세지 않는다.
  assert.equal(bundle.backlinks['overview']!.some((b) => b.kind === 'node'), false);
  assert.deepEqual(
    bundle.backlinks['decisions']!.map((b) => `${b.kind}:${b.id}`),
    ['glossary:G-retry', 'block:B-items', 'item:F1', 'row:R-order', 'row:R-retry'],
  );
  assert.deepEqual(
    bundle.backlinks['flow']!.map((b) => `${b.kind}:${b.id}`),
    [
      'block:B-seq',
      'step:S-recv',
      'step:S-queue',
      'step:S-work',
      'step:S-notify',
      'block:B-mermaid',
      'block:B-stages',
      'stage:S1',
      'item:S1.C1',
      'stage:S2',
      'item:S2.C1',
    ],
  );
  assert.deepEqual(bundle.backlinks['ledger'], []);
  assert.equal(bundle.backlinks['overview']![0]!.label, '대기열');
  assert.equal(bundle.backlinks['flow']![1]!.page, 'P-flow');
});

// ── 범위 밖 링크 ─────────────────────────────────────────────────────────────

test('sources 밖 링크를 건마다 경고로 남기고 수를 맞춘다', (t) => {
  const main = [
    '# 문서',
    '',
    '[안](b.md) 그리고 [밖](없음.md) 그리고 [웹](https://example.com) 그리고 [메일](mailto:a@b.c) 그리고 [절](#문서).',
    '',
    '[[b]] 와 [[없는것]].',
    '',
    '`[[코드안]]` 은 세지 않는다.',
    '',
    '```',
    '[[펜스안]]',
    '[밖](펜스밖.md)',
    '```',
    '',
  ].join('\n');
  const dir = makeVault({
    'projects/x/main.md': main,
    'projects/x/b.md': '# 나\n',
    'projects/x/config/viewer.yml': viewerYml(
      [
        '{id: main, path: projects/x/main.md, role: primary, kind: doc}',
        '{id: b, path: projects/x/b.md, role: primary, kind: doc}',
      ],
      ['- {type: prose, id: B1, text: 한 줄., evidence: [{source: main}]}'],
    ),
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bundle = collect({ projectDir: path.join(dir, 'projects', 'x'), git: GIT, now: NOW });
  const links = bundle.issues.filter((i) => i.code === 'W_LINK_UNRESOLVED');
  assert.equal(bundle.stamp.counts.unresolvedLinks, links.length);
  assert.equal(links.length, 2);
  assert.deepEqual(links.map((i) => i.where), ['docs.main:3', 'docs.main:5']);
  assert.equal(links[0]!.level, 'warning');
  assert.match(links[0]!.message, /없음\.md/);
  assert.match(links[1]!.message, /없는것/);
});

test('frontmatter가 있으면 링크 줄 번호도 파일 기준이다', (t) => {
  const dir = makeVault({
    'projects/x/main.md': '---\ntitle: 머리말\n---\n\n# 문서\n\n[밖](없음.md)\n',
    'projects/x/config/viewer.yml': viewerYml(
      ['{id: main, path: projects/x/main.md, role: primary, kind: doc}'],
      ['- {type: prose, id: B1, text: 한 줄., evidence: [{source: main}]}'],
    ),
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bundle = collect({ projectDir: path.join(dir, 'projects', 'x'), git: GIT, now: NOW });
  const links = bundle.issues.filter((i) => i.code === 'W_LINK_UNRESOLVED');
  assert.deepEqual(links.map((i) => i.where), ['docs.main:7']);
});

test('mini fixture에는 범위 밖 링크가 없다', () => {
  assert.equal(collectDemo().stamp.counts.unresolvedLinks, 0);
});

// ── 실패와 결정성 ────────────────────────────────────────────────────────────

test('검사 오류가 있으면 CheckError를 던진다', (t) => {
  const dir = makeVault({
    'projects/x/a.md': '# 있다\n',
    'projects/x/config/viewer.yml': viewerYml(
      ['{id: a, path: projects/x/a.md, role: primary, kind: doc}'],
      ['- {type: prose, id: B1, text: 근거가 없다.}'],
    ),
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const projectDir = path.join(dir, 'projects', 'x');
  assert.throws(
    () => collect({ projectDir, git: GIT, now: NOW }),
    (err: unknown) => {
      assert.ok(err instanceof CheckError);
      assert.ok(err.issues.some((i) => i.code === 'E_NO_EVIDENCE' && i.where === 'pages[0].blocks[0]'));
      return true;
    },
  );
});

test('viewer.yml이 없으면 예외다', (t) => {
  const dir = makeVault({ 'projects/x/a.md': '# 있다\n' });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => collect({ projectDir: path.join(dir, 'projects', 'x'), git: GIT, now: NOW }), /viewer\.yml/);
});

test('같은 입력이면 바이트 단위로 같은 Bundle이다', () => {
  const a = JSON.stringify(collectDemo());
  const b = JSON.stringify(collectDemo());
  assert.equal(a, b);
  assert.equal(JSON.parse(a).stamp.builtAt, '2026-09-19T00:00:00.000Z');
});

test('시계와 git이 다르면 스탬프만 달라진다', () => {
  const a = collectDemo();
  const b = collect({
    projectDir: DEMO,
    git: { commit: null, dirty: true },
    now: () => new Date('2026-09-20T00:00:00.000Z'),
  });
  assert.equal(JSON.stringify(a.docs), JSON.stringify(b.docs));
  assert.equal(JSON.stringify(a.viewer), JSON.stringify(b.viewer));
  assert.equal(b.stamp.commit, null);
  assert.equal(b.stamp.dirty, true);
  assert.equal(b.stamp.builtAt, '2026-09-20T00:00:00.000Z');
});

test('docCount는 등록된 원본 수다', () => {
  const bundle = collectDemo();
  assert.equal(bundle.stamp.docCount, Object.keys(bundle.docs).length);
  assert.equal(bundle.stamp.docCount, 4);
});

test('상태는 검사기가 낸 것을 그대로 옮긴다', () => {
  const bundle = collectDemo();
  assert.equal(bundle.status['S1']!.origin, 'ledger');
  assert.equal(bundle.status['S1']!.done, true);
  assert.equal(bundle.status['S2']!.origin, 'ledger-default');
});
