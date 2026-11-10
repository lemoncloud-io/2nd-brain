// 인라인 코드 경로 후보 판정과 찾는 차례(순수). 서버·화면이 같은 규칙을 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CODE_PATH_MAX_LEN, codePathProbes, looksLikeFile, parseCodePath, rootFallbackAllowed } from '../../shared/code-path.ts';

test('parseCodePath: 경로 후보 — `/` 가 있거나 아는 확장자로 끝난다', () => {
  assert.deepEqual(parseCodePath('outputs/2026-10-27-m1-structure-and-architecture.md'), {
    rel: 'outputs/2026-10-27-m1-structure-and-architecture.md',
    anchor: '',
    line: null,
    folder: false,
  });
  assert.deepEqual(parseCodePath('a/b.yml'), { rel: 'a/b.yml', anchor: '', line: null, folder: false });
  assert.deepEqual(parseCodePath('README.md'), { rel: 'README.md', anchor: '', line: null, folder: false });
  assert.deepEqual(parseCodePath('docs/'), { rel: 'docs', anchor: '', line: null, folder: true });
  assert.deepEqual(parseCodePath('projects/@acme/x'), { rel: 'projects/@acme/x', anchor: '', line: null, folder: false });
  assert.deepEqual(parseCodePath('../wiki/INDEX.md'), { rel: '../wiki/INDEX.md', anchor: '', line: null, folder: false });
});

test('parseCodePath: 앵커는 남기고 줄 꼬리(:12·:12:3)는 줄 번호로 뗀다', () => {
  assert.deepEqual(parseCodePath('wiki/INDEX.md#projects'), { rel: 'wiki/INDEX.md', anchor: 'projects', line: null, folder: false });
  assert.deepEqual(parseCodePath('src/app.ts:12'), { rel: 'src/app.ts', anchor: '', line: 12, folder: false });
  assert.deepEqual(parseCodePath('src/app.ts:12:3'), { rel: 'src/app.ts', anchor: '', line: 12, folder: false });
  assert.deepEqual(parseCodePath('main.py#L7'), { rel: 'main.py', anchor: 'L7', line: null, folder: false });
});

test('parseCodePath: 후보 아님 — 명령·URL·glob·낱말·여러 낱말·절대 경로·기호', () => {
  for (const t of [
    'npm test',
    'https://x/y',
    'mailto:a@b.c',
    'a*b.md',
    'src/**/*.ts',
    'a?.md',
    'foo',
    'Ctrl+K',
    'two words.md',
    'a/b c.md',
    '/Users/x/knowledge/wiki/INDEX.md',
    '~/knowledge/wiki',
    '$VAULT_DIR/wiki/INDEX.md',
    'src=pr:12',
    'npm:x/y',
    'ctx.root',
    '1.0.0',
    'a//b.md',
    '',
    `${'a'.repeat(CODE_PATH_MAX_LEN)}.md`,
    '--port',
    'f(a/b)',
  ]) {
    assert.equal(parseCodePath(t), null, t);
  }
});

test('looksLikeFile: 확장자가 있으면 파일, 없으면 파일·폴더 둘 다', () => {
  assert.equal(looksLikeFile('a/b.yml'), true);
  assert.equal(looksLikeFile('a/b'), false);
  assert.equal(looksLikeFile('a/.env'), false);
});

test('codePathProbes: 문서 폴더 기준 먼저, 루트 기준 다음 — 같으면 하나, 볼트 밖은 뺀다', () => {
  assert.deepEqual(codePathProbes('projects/demo-lib/README.md', 'outputs/x.md'), ['projects/demo-lib/outputs/x.md', 'outputs/x.md']);
  assert.deepEqual(codePathProbes('README.md', 'wiki/INDEX.md'), ['wiki/INDEX.md']);
  assert.deepEqual(codePathProbes('', 'wiki/INDEX.md'), ['wiki/INDEX.md']);
  // `..` 는 문서 폴더 기준에서만 뜻이 있다(루트 기준은 밖으로 나간다).
  assert.deepEqual(codePathProbes('projects/demo/README.md', '../../wiki/beta.md'), ['wiki/beta.md']);
  assert.deepEqual(codePathProbes('projects/demo/README.md', '../../../etc/hosts'), []);
  assert.deepEqual(codePathProbes('projects/demo/README.md', './a/b.md'), ['projects/demo/a/b.md', 'a/b.md']);
  // 이상한 from 은 루트 기준만.
  assert.deepEqual(codePathProbes('../x/README.md', 'a/b.md'), ['a/b.md']);
});

test('rootFallbackAllowed·codePathProbes: 루트 기준은 실제 조각이 둘 이상일 때만 — 맨 이름·한 조각 폴더는 문서 폴더 기준만', () => {
  assert.equal(rootFallbackAllowed('wiki/INDEX.md'), true);
  assert.equal(rootFallbackAllowed('projects/x/README.md'), true);
  assert.equal(rootFallbackAllowed('./wiki/INDEX.md'), true);
  assert.equal(rootFallbackAllowed('package.json'), false);
  assert.equal(rootFallbackAllowed('CLAUDE.md'), false);
  assert.equal(rootFallbackAllowed('./README.md'), false);
  // 폴더 후보는 끝 `/` 를 뗀 rel 로 온다 — `docs/` 는 한 조각이다.
  assert.equal(rootFallbackAllowed(parseCodePath('docs/')!.rel), false);
  assert.equal(rootFallbackAllowed(parseCodePath('docs/adr/')!.rel), true);
  const from = 'projects/@acme/app/README.md';
  assert.deepEqual(codePathProbes(from, 'package.json'), ['projects/@acme/app/package.json']);
  assert.deepEqual(codePathProbes(from, 'CLAUDE.md'), ['projects/@acme/app/CLAUDE.md']);
  assert.deepEqual(codePathProbes(from, 'docs'), ['projects/@acme/app/docs']);
  assert.deepEqual(codePathProbes(from, 'wiki/INDEX.md'), ['projects/@acme/app/wiki/INDEX.md', 'wiki/INDEX.md']);
  // 루트에 있는 문서는 문서 폴더가 곧 루트다 — 맨 이름도 찾는다.
  assert.deepEqual(codePathProbes('README.md', 'CLAUDE.md'), ['CLAUDE.md']);
  // 문서 폴더가 없으면(from 이 비었거나 이상함) 맨 이름은 찾을 곳이 없다.
  assert.deepEqual(codePathProbes('', 'CLAUDE.md'), []);
  assert.deepEqual(codePathProbes('../x/README.md', 'a.md'), []);
});
