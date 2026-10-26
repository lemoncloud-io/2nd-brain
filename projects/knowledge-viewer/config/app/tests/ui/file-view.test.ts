// 텍스트 파일 보기: 줄 나누기·변경 조각(순수)과 SSR 로 그린 줄 번호·변경 표시·바이너리·에이전트 모드.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import { formatSize, lineOfAnchor, segmentsOf, splitLines } from '../../src/reader/file-lines.ts';
import type { FileResponse } from '../../src/reader/file-lines.ts';
import { CHANGED_SELECTOR } from '../../src/reader/changed-dom.ts';

const { FileBody } = await import('../../src/reader/FileView.tsx');

test('splitLines: 끝 줄바꿈 하나는 줄이 아니고 \\r 은 뗀다', () => {
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines('a\nb\n'), ['a', 'b']);
  assert.deepEqual(splitLines('a\r\n\r\nb'), ['a', '', 'b']);
});

test('segmentsOf: hunk 는 한 덩어리, 지운 자리는 afterLine 뒤(0 은 맨 앞), 파일 밖 hunk 는 버린다', () => {
  const lines = ['1', '2', '3', '4', '5'];
  const s = segmentsOf(lines, {
    status: 'M',
    hunks: [
      { start: 4, end: 9 },
      { start: 2, end: 3 },
      { start: 8, end: 9 },
    ],
    removed: [
      { afterLine: 0, count: 2 },
      { afterLine: 5, count: 1 },
    ],
    added: 0,
    deleted: 0,
  });
  assert.deepEqual(
    s.map((x) => (x.kind === 'line' ? `L${x.line.n}` : x.kind === 'hunk' ? `H${x.start}-${x.end}` : `R${x.afterLine}x${x.count}`)),
    ['R0x2', 'L1', 'H2-3', 'H4-5', 'R5x1'],
  );
  assert.deepEqual(segmentsOf(['a'], null), [{ kind: 'line', line: { n: 1, text: 'a' } }]);
});

test('lineOfAnchor·formatSize', () => {
  assert.equal(lineOfAnchor('L12'), 12);
  assert.equal(lineOfAnchor('l12'), null);
  assert.equal(lineOfAnchor('section'), null);
  assert.equal(formatSize(900), '900 B');
  assert.equal(formatSize(2048), '2.0 KB');
});

const file = (over: Partial<FileResponse> = {}): FileResponse => ({
  path: 'projects/demo/app.ts',
  size: 30,
  text: 'const a = 1;\nconst b = <b>;\n\nexport {};\n',
  truncated: false,
  binary: false,
  ...over,
});
const render = (f: FileResponse, agent = false): string => renderToStaticMarkup(createElement(FileBody, { file: f, agent, rawUrl: 'http://localhost:1/raw/x' }));

test('FileBody: 이름 머리·줄 번호·id·글은 이스케이프된 텍스트', () => {
  const h = render(file());
  assert.match(h, /^<section class="doc file-view" data-vault-path="projects\/demo\/app.ts">/);
  assert.match(h, /<h1 class="file-view-name">app.ts<\/h1>/);
  assert.match(h, /4줄 · 30 B/);
  assert.match(h, /<span class="file-line" id="L1"><span class="file-ln" data-ln="1" aria-hidden="true"><\/span><span class="file-text">const a = 1;<\/span><\/span>/);
  assert.match(h, /<span class="file-text">const b = &lt;b&gt;;<\/span>/);
  assert.match(h, /id="L4"/);
  assert.doesNotMatch(h, /id="L5"/);
  assert.match(h, /style="--ln-ch:1"/);
  assert.doesNotMatch(h, /changed/);
});

test('FileBody: PR 변경은 hunk 덩어리 .changed 와 data-removed — 리더와 같은 표식', () => {
  const h = render(file({ change: { status: 'M', hunks: [{ start: 2, end: 3 }], removed: [{ afterLine: 4, count: 2 }], added: 2, deleted: 3 } }));
  assert.match(h, /<span class="file-hunk changed" data-lines="2-3"><span class="file-line" id="L2">/);
  assert.match(h, /<span class="file-removed" data-removed="2"><\/span>/);
  assert.match(h, /이 PR: M · 추가 2줄 · 삭제 3줄/);
  // CHANGED_SELECTOR 의 클래스·속성을 쓴다(PR 상세의 이동 단추가 센다).
  assert.ok(CHANGED_SELECTOR.includes('.changed') && CHANGED_SELECTOR.includes('[data-removed]'));
});

test('FileBody: 바이너리는 본문 없이 원본 받기, 잘림은 안내, 변경 실패는 까닭', () => {
  const bin = render(file({ binary: true, text: '', path: 'a/pic.png' }));
  assert.match(bin, /바이너리 파일 — <a href="http:\/\/localhost:1\/raw\/x" target="_blank" rel="noreferrer">원본 받기<\/a>/);
  assert.doesNotMatch(bin, /file-code/);
  assert.match(render(file({ truncated: true, size: 600000 })), /만 보인다\(전체 585.9 KB\)/);
  assert.match(render(file({ changeError: 'ref 가 없다' })), /이 파일의 변경을 못 읽었다: ref 가 없다/);
  assert.match(render(file({ text: '' })), /빈 파일이다/);
});

test('FileBody: 에이전트 모드는 스타일 없는 <pre data-vault-path> 텍스트, 변경은 data-changed', () => {
  const h = render(file({ change: { status: 'M', hunks: [{ start: 2, end: 2 }], removed: [], added: 1, deleted: 0 } }), true);
  assert.match(h, /^<pre data-vault-path="projects\/demo\/app.ts" data-size="30">const a = 1;\n<span data-changed="1" data-lines="2-2">const b = &lt;b&gt;;\n<\/span>\nexport \{\};\n<\/pre>$/);
  assert.doesNotMatch(h, /class=/);
  assert.match(render(file({ binary: true, text: '' }), true), /^<p data-vault-path="projects\/demo\/app.ts" data-binary="1">/);
});

test('FileBody: 앵커 줄은 file-line-target', () => {
  const h = renderToStaticMarkup(createElement(FileBody, { file: file(), agent: false, rawUrl: '/raw/x', targetLine: 2 }));
  assert.match(h, /<span class="file-line file-line-target" id="L2">/);
  assert.equal((h.match(/file-line-target/g) ?? []).length, 1);
});
