// 본문 인라인 코드 → 볼트 경로 링크: 후보 고르기(펜스 안 제외·상한), 여는 곳 판정, 리더 SSR(찾은 코드만 링크, 펜스 코드는 그대로).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import { CODE_PATH_MAX_BATCH } from '../../shared/code-path.ts';
import { LOCAL } from '../../shared/source.ts';
import type { DocResponse } from '../../src/app/types.ts';
import { CODE_PATH_QUERY_BUDGET, codePathCandidates, codePathTarget, inlineCodeSpans } from '../../src/reader/code-paths.ts';

const { Reader } = await import('../../src/reader/Reader.tsx');

test('inlineCodeSpans: 한 줄 안의 인라인 코드만, 펜스(``` ~~~) 안은 건너뛴다, 겹 백틱·앞뒤 빈칸 한 칸', () => {
  const md = [
    '표 | `outputs/a.md` | `npm test`',
    '```',
    '`inside/fence.md`',
    '```',
    '~~~~ts',
    '`also/inside.md`',
    '~~~~',
    '``a`b`` 와 `` `c/d.md` `` 와 `` e/f.md ``',
  ].join('\n');
  assert.deepEqual(inlineCodeSpans(md), ['outputs/a.md', 'npm test', 'a`b', '`c/d.md`', 'e/f.md']);
});

test('codePathCandidates: 후보만, 겹침 없이, 나온 차례 — 개수 상한 200·글자 수 예산', () => {
  assert.deepEqual(codePathCandidates('`a/b.yml` `foo` `a/b.yml` `README.md` `docs/` `npm test` `https://x/y`'), ['a/b.yml', 'README.md', 'docs/']);
  const many = Array.from({ length: CODE_PATH_MAX_BATCH + 50 }, (_, i) => `\`d/${i}.md\``).join(' ');
  assert.equal(codePathCandidates(many).length, CODE_PATH_MAX_BATCH);
  const long = Array.from({ length: 100 }, (_, i) => `\`${'x'.repeat(200)}/${i}.md\``).join(' ');
  const got = codePathCandidates(long);
  assert.ok(got.length < 100);
  assert.ok(got.reduce((n, s) => n + encodeURIComponent(s).length + 3, 0) <= CODE_PATH_QUERY_BUDGET);
});

test('codePathTarget: md 는 리더(앵커 유지), 폴더는 폴더 주소, 텍스트·html 은 앱 안(:12 → #L12), 그 밖은 원본', () => {
  assert.deepEqual(codePathTarget('wiki/INDEX.md#x', { path: 'wiki/INDEX.md', kind: 'md' }), { kind: 'md', path: 'wiki/INDEX.md', anchor: 'x' });
  assert.deepEqual(codePathTarget('docs/', { path: 'p/docs', kind: 'folder' }), { kind: 'app', path: 'p/docs/', anchor: '' });
  assert.deepEqual(codePathTarget('a/b.ts:12', { path: 'p/a/b.ts', kind: 'file' }), { kind: 'app', path: 'p/a/b.ts', anchor: 'L12' });
  assert.deepEqual(codePathTarget('a/b.yml#top', { path: 'p/a/b.yml', kind: 'file' }), { kind: 'app', path: 'p/a/b.yml', anchor: '' });
  assert.deepEqual(codePathTarget('out/v.html', { path: 'out/v.html', kind: 'file' }), { kind: 'app', path: 'out/v.html', anchor: '' });
  assert.deepEqual(codePathTarget('img/a.png', { path: 'img/a.png', kind: 'file' }), { kind: 'raw', path: 'img/a.png' });
});

const doc = (body: string, path = 'projects/demo-lib/README.md'): DocResponse => ({
  source: 'local',
  head: null,
  path,
  title: 'doc',
  frontmatter: {},
  body,
  bodyStartLine: 1,
  headings: [],
  links: [],
  backlinks: [],
  stamp: { commit: null, dirty: false },
  mtime: 0,
  ignored: false,
});

const render = (body: string, codePaths?: Record<string, { path: string; kind: 'md' | 'file' | 'folder' } | null>): string =>
  renderToStaticMarkup(createElement(Reader, { doc: doc(body), agent: false, src: LOCAL, onNavigate: () => {}, codePaths }));

test('Reader: 찾은 인라인 코드는 코드 모양 그대로 링크, 못 찾은 것·펜스 코드는 그대로', () => {
  const body = [
    '| 산출물 | 설명 |',
    '| --- | --- |',
    '| `outputs/2026-10-27-m1-structure-and-architecture.md` | 구조 |',
    '',
    '설정은 `config/app.yml:3`, 폴더는 `docs/`, 없는 것은 `outputs/none.md`, 명령은 `npm test`.',
    '',
    '```',
    'outputs/2026-10-27-m1-structure-and-architecture.md',
    '```',
  ].join('\n');
  const html = render(body, {
    'outputs/2026-10-27-m1-structure-and-architecture.md': { path: 'projects/demo-lib/outputs/2026-10-27-m1-structure-and-architecture.md', kind: 'md' },
    'config/app.yml:3': { path: 'projects/demo-lib/config/app.yml', kind: 'file' },
    'docs/': { path: 'projects/demo-lib/docs', kind: 'folder' },
    'outputs/none.md': null,
  });
  assert.match(
    html,
    /<a href="\/v\/projects\/demo-lib\/outputs\/2026-10-27-m1-structure-and-architecture\.md\?src=local" data-vault-path="projects\/demo-lib\/outputs\/2026-10-27-m1-structure-and-architecture\.md"[^>]*><code class="code-link">outputs\/2026-10-27-m1-structure-and-architecture\.md<\/code><\/a>/,
  );
  assert.match(html, /<a href="\/v\/projects\/demo-lib\/config\/app\.yml\?src=local#L3"[^>]*><code class="code-link">config\/app\.yml:3<\/code><\/a>/);
  assert.match(html, /<a href="\/v\/projects\/demo-lib\/docs\/\?src=local"[^>]*><code class="code-link">docs\/<\/code><\/a>/);
  assert.match(html, /<code>outputs\/none\.md<\/code>/);
  assert.match(html, /<code>npm test<\/code>/);
  // 펜스 코드는 링크가 아니다 — 같은 글이 표에 있어도.
  assert.match(html, /<pre><code>outputs\/2026-10-27-m1-structure-and-architecture\.md\n<\/code><\/pre>/);
  assert.equal((html.match(/code-link/g) ?? []).length, 3);
});

test('Reader: 표가 없으면(묻는 중) 출처 문자열만 링크 — 예전과 같다', () => {
  const html = render('`raw/src.md` 와 `outputs/a.md`');
  assert.match(html, /<a href="\/v\/raw\/src\.md\?src=local" data-vault-path="raw\/src\.md"><code>raw\/src\.md<\/code><\/a>/);
  assert.match(html, /<code>outputs\/a\.md<\/code>/);
  assert.equal(html.includes('code-link'), false);
});

test('Reader: 인라인 코드가 Object.prototype 이름이어도 상속된 값을 경로로 읽지 않는다', () => {
  const names = Object.getOwnPropertyNames(Object.prototype);
  const html = render(names.map((name) => '`' + name + '`').join(' '), {});
  for (const name of names) assert.ok(html.includes('<code>' + name + '</code>'));
  assert.equal(html.includes('code-link'), false);
});

test('Reader: 경로 표의 상속 항목은 링크가 아니고 JSON의 명시적 null도 그대로 남는다', () => {
  const inherited = Object.create({ 'outputs/inherited.md': { path: 'outputs/inherited.md', kind: 'md' } });
  assert.match(render('`outputs/inherited.md`', inherited), /<code>outputs\/inherited\.md<\/code>/);
  assert.equal(render('`outputs/inherited.md`', inherited).includes('code-link'), false);
  assert.match(render('`__proto__`', JSON.parse('{"__proto__":null}')), /<code>__proto__<\/code>/);
});
