// 원문 md 안의 링크 판정. 리더(브라우저)와 loader가 같은 기준을 쓰기 때문에 순수성도 함께 고정한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { classifyLink, resolveWikilink } from '../../loader/doclinks.ts';

const SOURCES = new Map<string, string>([
  ['projects/demo/docs/overview.md', 'overview'],
  ['projects/demo/docs/flow.md', 'flow'],
  ['projects/demo/docs/status.yml', 'ledger'],
  ['projects/other/notes.md', 'notes'],
]);
const FROM = 'projects/demo/docs/overview.md';

test('http·https는 external이다', () => {
  assert.deepEqual(classifyLink('https://example.com/a', FROM, SOURCES), { kind: 'external' });
  assert.deepEqual(classifyLink('http://example.com', FROM, SOURCES), { kind: 'external' });
});

test('mailto 등 다른 스킴은 blocked다 — 링크를 만들지 않는다', () => {
  const r = classifyLink('mailto:a@example.com', FROM, SOURCES);
  assert.equal(r.kind, 'blocked');
  assert.match(r.kind === 'blocked' ? r.reason : '', /mailto/);
  assert.equal(classifyLink('ftp://h/x', FROM, SOURCES).kind, 'blocked');
  assert.equal(classifyLink('javascript:alert(1)', FROM, SOURCES).kind, 'blocked');
});

test('같은 문서 안의 #절은 same-doc이다', () => {
  assert.deepEqual(classifyLink('#구성-단위', FROM, SOURCES), { kind: 'same-doc', slug: '구성-단위' });
});

test('빈 대상과 빈 조각은 missing이다', () => {
  assert.equal(classifyLink('', FROM, SOURCES).kind, 'missing');
  assert.equal(classifyLink('#', FROM, SOURCES).kind, 'missing');
});

test('같은 폴더 상대경로는 internal이다', () => {
  assert.deepEqual(classifyLink('flow.md', FROM, SOURCES), { kind: 'internal', source: 'flow' });
});

test('.. 상대경로와 조각은 internal + slug다', () => {
  assert.deepEqual(classifyLink('../../other/notes.md#절', FROM, SOURCES), {
    kind: 'internal',
    source: 'notes',
    slug: '절',
  });
});

test('퍼센트 인코딩된 경로와 조각을 푼다', () => {
  assert.deepEqual(classifyLink('../docs/flow.md#%EB%B0%9B%EA%B8%B0', FROM, SOURCES), {
    kind: 'internal',
    source: 'flow',
    slug: '받기',
  });
});

test('sources 밖 상대경로는 missing이다', () => {
  const r = classifyLink('./없는문서.md', FROM, SOURCES);
  assert.equal(r.kind, 'missing');
  assert.match(r.kind === 'missing' ? r.reason : '', /없는문서\.md/);
});

test('볼트 밖으로 나가는 상대경로는 missing이다', () => {
  const r = classifyLink('../../../../밖.md', FROM, SOURCES);
  assert.equal(r.kind, 'missing');
  assert.match(r.kind === 'missing' ? r.reason : '', /볼트 밖/);
});

test('절대경로 링크는 missing이다 — 추측해서 바깥으로 보내지 않는다', () => {
  const r = classifyLink('/projects/demo/docs/flow.md', FROM, SOURCES);
  assert.equal(r.kind, 'missing');
  assert.match(r.kind === 'missing' ? r.reason : '', /절대경로/);
});

test('위키링크는 볼트 상대 전체경로로 맞는다', () => {
  assert.deepEqual(resolveWikilink('projects/demo/docs/flow.md', SOURCES), { kind: 'internal', source: 'flow' });
});

test('위키링크는 확장자 없는 경로로도 맞는다', () => {
  assert.deepEqual(resolveWikilink('projects/demo/docs/flow', SOURCES), { kind: 'internal', source: 'flow' });
});

test('위키링크는 파일 이름만으로도 맞는다', () => {
  assert.deepEqual(resolveWikilink('flow', SOURCES), { kind: 'internal', source: 'flow' });
  assert.deepEqual(resolveWikilink('status.yml', SOURCES), { kind: 'internal', source: 'ledger' });
});

test('위키링크의 별칭과 조각을 떼고 본다', () => {
  assert.deepEqual(resolveWikilink('flow#받기|흐름', SOURCES), { kind: 'internal', source: 'flow', slug: '받기' });
  assert.deepEqual(resolveWikilink('flow|흐름', SOURCES), { kind: 'internal', source: 'flow' });
});

test('sources 밖 위키링크는 missing이다', () => {
  const r = resolveWikilink('없는문서', SOURCES);
  assert.equal(r.kind, 'missing');
  assert.match(r.kind === 'missing' ? r.reason : '', /없는문서/);
});

test('위키링크가 조각뿐이면 same-doc이다', () => {
  assert.deepEqual(resolveWikilink('#구성-단위', SOURCES), { kind: 'same-doc', slug: '구성-단위' });
});

test('doclinks는 Node 내장 모듈을 import하지 않는다 — 리더가 브라우저에서 쓴다', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'loader', 'doclinks.ts'), 'utf8');
  assert.equal(/from\s+['"]node:/.test(src), false);
  assert.equal(/from\s+['"](fs|path|url|crypto|child_process)['"]/.test(src), false);
});
