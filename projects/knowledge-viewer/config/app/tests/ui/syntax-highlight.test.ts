// 코드 구문 강조: 언어 표(확장자·펜스 별칭), hljs HTML → 토큰 트리, 줄 쪼개기(열린 span 다시 열기),
// 토큰을 벗기면 원문, 상한, 그리고 파일 보기·리더가 그리는 구조(SSR)를 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import { HL_LANGS, langOfClassName, langOfFence, langOfPath } from '../../src/reader/highlight-langs.ts';
import {
  highlightNodes,
  loadHighlighter,
  MAX_HL_CHARS,
  MAX_HL_LINES,
  parseHljsHtml,
  splitHlLines,
  textOf,
  withinHlLimit,
  type HlNode,
} from '../../src/reader/highlight.ts';
import type { FileResponse } from '../../src/reader/file-lines.ts';

const { FileBody } = await import('../../src/reader/FileView.tsx');
const { Reader } = await import('../../src/reader/Reader.tsx');

// 태그를 벗긴 글자(엔티티 되돌림). SSR 결과의 텍스트 비교용.
const plain = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');

test('langOfPath: 확장자 표, Dockerfile, md·모르는 확장자는 null', () => {
  assert.equal(langOfPath('a/b/carrot-api.ts'), 'typescript');
  assert.equal(langOfPath('x.tsx'), 'typescript');
  assert.equal(langOfPath('x.mts'), 'typescript');
  assert.equal(langOfPath('x.py'), 'python');
  assert.equal(langOfPath('x.mjs'), 'javascript');
  assert.equal(langOfPath('x.jsx'), 'javascript');
  assert.equal(langOfPath('run.sh'), 'bash');
  assert.equal(langOfPath('.zshrc.zsh'), 'bash');
  assert.equal(langOfPath('c.YML'), 'yaml');
  assert.equal(langOfPath('package.json'), 'json');
  assert.equal(langOfPath('q.sql'), 'sql');
  assert.equal(langOfPath('m.go'), 'go');
  assert.equal(langOfPath('A.java'), 'java');
  assert.equal(langOfPath('s.css'), 'css');
  assert.equal(langOfPath('i.html'), 'xml');
  assert.equal(langOfPath('pyproject.toml'), 'ini');
  assert.equal(langOfPath('deploy/Dockerfile'), 'dockerfile');
  assert.equal(langOfPath('Dockerfile.dev'), 'dockerfile');
  assert.equal(langOfPath('README.md'), null);
  assert.equal(langOfPath('notes.txt'), null);
  assert.equal(langOfPath('Makefile'), null);
  assert.equal(langOfPath('.gitignore'), null);
  assert.equal(langOfPath('x.__proto__'), null);
});

test('langOfFence·langOfClassName: 별칭, 대소문자 무관, mermaid·모르는 값·빈 값은 null', () => {
  assert.equal(langOfFence('ts'), 'typescript');
  assert.equal(langOfFence('TypeScript'), 'typescript');
  assert.equal(langOfFence('py'), 'python');
  assert.equal(langOfFence('sh'), 'bash');
  assert.equal(langOfFence('zsh'), 'bash');
  assert.equal(langOfFence('console'), 'bash');
  assert.equal(langOfFence('jsonc'), 'json');
  assert.equal(langOfFence('yml'), 'yaml');
  assert.equal(langOfFence('html'), 'xml');
  assert.equal(langOfFence('toml'), 'ini');
  assert.equal(langOfFence('mermaid'), null);
  assert.equal(langOfFence('brainfuck'), null);
  assert.equal(langOfFence(''), null);
  assert.equal(langOfFence(undefined), null);
  assert.equal(langOfFence('constructor'), null);
  assert.equal(langOfClassName(['language-py']), 'python');
  assert.equal(langOfClassName('language-ts'), 'typescript');
  assert.equal(langOfClassName(['language-mermaid']), null);
  assert.equal(langOfClassName(undefined), null);
  // 지원 언어는 모두 펜스 이름으로 받는다.
  for (const l of HL_LANGS) assert.equal(langOfFence(l), l);
});

test('parseHljsHtml: span 트리, 엔티티 되돌림, 짝 안 맞는 닫기는 버린다', () => {
  assert.deepEqual(parseHljsHtml('<span class="hljs-keyword">const</span> a = <span class="hljs-string">&quot;&lt;&amp;&#x27;&quot;</span>;'), [
    { cls: 'hljs-keyword', children: ['const'] },
    ' a = ',
    { cls: 'hljs-string', children: ['"<&\'"'] },
    ';',
  ]);
  assert.deepEqual(parseHljsHtml('<span class="hljs-title class_">A</span></span>b'), [{ cls: 'hljs-title class_', children: ['A'] }, 'b']);
  assert.deepEqual(parseHljsHtml('a < b'), ['a < b']);
});

test('splitHlLines: 여러 줄 span 은 줄마다 다시 열고, 줄 수는 split 과 같고, 글자는 그대로', () => {
  const nodes: HlNode[] = ['x ', { cls: 'hljs-comment', children: ['/* a\nb ', { cls: 'hljs-doctag', children: ['@c\nd'] }, ' */'] }, '\n\ny'];
  const lines = splitHlLines(nodes);
  assert.equal(lines.length, textOf(nodes).split('\n').length);
  assert.deepEqual(lines, [
    ['x ', { cls: 'hljs-comment', children: ['/* a'] }],
    [{ cls: 'hljs-comment', children: ['b ', { cls: 'hljs-doctag', children: ['@c'] }] }],
    [{ cls: 'hljs-comment', children: [{ cls: 'hljs-doctag', children: ['d'] }, ' */'] }],
    [],
    ['y'],
  ]);
  assert.deepEqual(
    lines.map((l) => textOf(l)),
    textOf(nodes).split('\n'),
  );
  // 같은 class 의 이웃 span 둘은 한 줄 안에서도 따로 남는다.
  assert.deepEqual(splitHlLines([{ cls: 'k', children: ['a'] }, { cls: 'k', children: ['b'] }]), [[{ cls: 'k', children: ['a'] }, { cls: 'k', children: ['b'] }]]);
});

const TS = [
  "import { x } from './y.ts';",
  '/**',
  ' * 여러 줄 주석 <b> & "따옴표"',
  ' */',
  'export const greet = (name: string): string => `hi ${name}',
  'and more`;',
  'class A extends B { n = 42; }',
].join('\n');

test('실제 hljs: 토큰을 벗기면 원문과 같고, 블록 주석·템플릿 문자열이 줄 경계에서 다시 열린다', async () => {
  const hljs = await loadHighlighter('typescript');
  const nodes = highlightNodes(hljs, TS, 'typescript');
  assert.ok(nodes !== null);
  assert.equal(textOf(nodes), TS);
  const lines = splitHlLines(nodes);
  assert.equal(lines.length, 7);
  assert.deepEqual(
    lines.map((l) => textOf(l)),
    TS.split('\n'),
  );
  // 3행(주석 가운데)과 6행(템플릿 문자열 뒷부분)은 첫 마디가 그 span 이다.
  const head = (l: HlNode[]) => (typeof l[0] === 'string' ? null : l[0]!.cls);
  assert.equal(head(lines[2]!), 'hljs-comment');
  assert.equal(head(lines[5]!), 'hljs-string');
  assert.ok(JSON.stringify(lines[0]).includes('hljs-keyword'));
  // 파이썬도 원문이 그대로다.
  const py = 'def f(x: int) -> str:\n    """doc\n    string"""\n    return f"{x}"  # 끝\n';
  const pyNodes = highlightNodes(await loadHighlighter('python'), py, 'python');
  assert.ok(pyNodes !== null);
  assert.equal(textOf(pyNodes), py);
});

test('상한: 글자 수·줄 수를 넘으면 강조하지 않는다', () => {
  assert.ok(withinHlLimit('a\nb'));
  assert.ok(!withinHlLimit('x'.repeat(MAX_HL_CHARS + 1)));
  assert.ok(withinHlLimit('\n'.repeat(MAX_HL_LINES - 1)));
  assert.ok(!withinHlLimit('\n'.repeat(MAX_HL_LINES)));
});

const file = (path: string, text: string, extra: Partial<FileResponse> = {}): FileResponse => ({
  path,
  size: text.length,
  text,
  truncated: false,
  binary: false,
  ...extra,
});

test('파일 보기: 토큰이 있으면 줄 구조(번호·id·변경 덩어리)는 그대로, 글자만 span 으로 — 벗기면 원문', async () => {
  const nodes = highlightNodes(await loadHighlighter('typescript'), TS, 'typescript')!;
  const tokens = splitHlLines(nodes);
  const f = file('a/carrot-api.ts', TS + '\n', { change: { status: 'M', hunks: [{ start: 2, end: 4 }], removed: [], added: 3, deleted: 0 } });
  const html = renderToStaticMarkup(createElement(FileBody, { file: f, agent: false, rawUrl: '/raw/a', tokens }));
  const base = renderToStaticMarkup(createElement(FileBody, { file: f, agent: false, rawUrl: '/raw/a', tokens: null }));
  // 줄 7개·번호·덩어리 표식은 강조 전과 같다.
  assert.equal((html.match(/class="file-line[ "]/g) ?? []).length, 7);
  assert.match(html, /id="L6"/);
  assert.match(html, /data-ln="7"/);
  assert.match(html, /class="file-hunk changed" data-lines="2-4"/);
  assert.match(html, /<span class="hljs-keyword">/);
  // 토큰 span 은 class 만 단다(data-* 없음).
  assert.doesNotMatch(html, /<span class="hljs-[^"]*" data-/);
  // 텍스트는 강조 전과 같다.
  assert.equal(plain(html), plain(base));
  assert.doesNotMatch(base, /hljs-/);
});

test('파일 보기: 에이전트 모드·SSR 첫 그림·모르는 언어는 단색', () => {
  const ts = renderToStaticMarkup(createElement(FileBody, { file: file('a.ts', TS), agent: false, rawUrl: '/raw/a' }));
  assert.doesNotMatch(ts, /hljs-/);
  const agent = renderToStaticMarkup(createElement(FileBody, { file: file('a.ts', TS), agent: true, rawUrl: '/raw/a' }));
  assert.doesNotMatch(agent, /hljs-|class=/);
  assert.equal(plain(agent), TS + '\n');
  // 줄 수가 어긋난 토큰은 버린다.
  const bad = renderToStaticMarkup(createElement(FileBody, { file: file('a.ts', TS), agent: false, rawUrl: '/raw/a', tokens: [['x']] }));
  assert.doesNotMatch(bad, />x</);
});

test('리더: 언어 붙은 코드 블록은 SSR 첫 그림이 지금과 같고(language-* 유지), mermaid 는 그대로', () => {
  const doc = {
    path: 'a.md',
    body: '```ts\nconst a = 1;\n```\n\n```mermaid\ngraph TD; A-->B\n```\n\n```\nplain\n```\n',
    title: 'a',
    frontmatter: {},
    bodyStartLine: 1,
    headings: [],
    links: [],
    backlinks: [],
    stamp: { commit: null, dirty: false },
    mtime: 0,
    ignored: false,
  };
  const html = renderToStaticMarkup(createElement(Reader, { doc: doc as never, agent: false, onNavigate: () => {}, codePaths: {} }));
  assert.match(html, /<pre><code class="language-ts">const a = 1;\n<\/code><\/pre>/);
  assert.match(html, /<pre><code>plain\n<\/code><\/pre>/);
  assert.doesNotMatch(html, /language-mermaid/);
  const agent = renderToStaticMarkup(createElement(Reader, { doc: doc as never, agent: true, onNavigate: () => {}, codePaths: {} }));
  assert.match(agent, /<pre><code class="language-ts">const a = 1;\n<\/code><\/pre>/);
});
