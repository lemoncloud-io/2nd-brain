// 리더 SSR: callout DOM(정화 뒤에도 남는가·접기·아이콘·에이전트 모드) 과 임베드(이미지 = ![](path) 와 같다 · 노트 상자 · 안내 상자).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import type { DocEmbed, DocLink, DocResponse } from '../../src/app/types.ts';

const { Reader } = await import('../../src/reader/Reader.tsx');

const link = (target: string, path: string | null, embed = true): DocLink => ({
  kind: 'wiki',
  target,
  anchor: null,
  label: target,
  line: 1,
  embed,
  path,
  candidates: [],
});

const doc = (body: string, extra: Partial<DocResponse> = {}): DocResponse => ({
  source: 'local',
  head: null,
  path: 'wiki/host.md',
  title: 'host',
  frontmatter: {},
  body,
  bodyStartLine: 1,
  headings: [],
  links: [],
  backlinks: [],
  stamp: { commit: null, dirty: false },
  mtime: 0,
  ignored: false,
  ...extra,
});

const render = (body: string, extra: Partial<DocResponse> = {}, agent = false): string =>
  renderToStaticMarkup(createElement(Reader, { doc: doc(body, extra), agent, onNavigate: () => {} }));

/** 이미지 시험은 디스크(local) 소스로 본다 — Reader 의 기본 소스는 main 이다. */
const renderLocal = (body: string, extra: Partial<DocResponse> = {}, agent = false): string =>
  renderToStaticMarkup(createElement(Reader, { doc: doc(body, extra), agent, src: { kind: 'local' }, onNavigate: () => {} }));

test('callout: aside·클래스·data-callout·제목 줄·아이콘 SVG·본문이 정화 뒤에도 남는다', () => {
  const html = render('> [!warning] 조심\n> 본문 **굵게**');
  assert.match(html, /<aside class="callout callout-warning" data-callout="warning">/);
  assert.match(html, /<div class="callout-title"><span class="callout-icon" aria-hidden="true"><svg class="icon"/);
  assert.match(html, /<span class="callout-title-text">조심<\/span>/);
  assert.match(html, /<div class="callout-body">\s*<p>본문 <strong>굵게<\/strong><\/p>/);
  // 아이콘 이름 속성은 그릴 때만 쓰고 남기지 않는다.
  assert.ok(!html.includes('data-icon'), html);
});

test('callout 접기: - 는 닫힌 details, + 는 open', () => {
  const closed = render('> [!note]- 접힘\n> 숨은 본문');
  assert.match(closed, /<aside class="callout callout-note" data-callout="note">\s*<details>\s*<summary class="callout-title">/);
  const open = render('> [!tip]+ 펼침\n> 본문');
  assert.match(open, /<details open="">\s*<summary class="callout-title">/);
});

test('callout: 모르는 종류는 note 계열 + 원래 이름, 제목은 종류 이름', () => {
  const html = render('> [!custom]\n> 본문');
  assert.match(html, /<aside class="callout callout-note" data-callout="custom">/);
  assert.match(html, /<span class="callout-title-text">Custom<\/span>/);
});

test('callout: 에이전트 모드도 같은 DOM 이다', () => {
  const md = '> [!abstract] 요약\n> 본문';
  assert.equal(render(md, {}, true), render(md, {}, false));
});

test('callout: 원문 HTML 로 다른 클래스·data-* 를 끼워도 벗겨진다', () => {
  const html = render('<aside class="callout evil" data-x="1" onclick="alert(1)">x</aside>\n\n<span class="callout-icon other" data-icon="warning">y</span>');
  assert.match(html, /<aside class="callout">x<\/aside>/);
  assert.ok(!html.includes('evil') && !html.includes('data-x') && !html.includes('onclick') && !html.includes('other'), html);
});

test('callout: PR 변경 표시(changed)가 aside 에 남는다', () => {
  const html = render('> [!info] 제목\n> 본문', {
    change: { status: 'M', hunks: [{ start: 1, end: 2 }], removed: [], added: 2, deleted: 0 },
  });
  assert.match(html, /<aside class="callout callout-info changed" data-callout="info">/);
});

test('이미지 ![](a.png): 문서 기준 /raw 로 그리고, 누르면 새 탭(같은 주소), title 에 원 경로', () => {
  const html = renderLocal('![그림](a.png)');
  assert.match(
    html,
    /<a class="img-open" href="\/raw\/wiki\/a.png" target="_blank" rel="noreferrer"><img src="\/raw\/wiki\/a.png" alt="그림" title="a.png" loading="lazy" decoding="async"\/><\/a>/,
  );
  assert.ok(!html.includes('img-badge'), html);
});

test('이미지 임베드 ![[b.png|640]]: 서버가 푼 링크 경로로 그리고 폭은 width — 못 푼 것은 배지', () => {
  const links = [link('b.png', 'outputs/assets/b.png'), link('none.png', null)];
  const html = renderLocal('![[b.png|640]]\n\n![[none.png]]', { links });
  assert.match(html, /<img src="\/raw\/outputs\/assets\/b.png" alt="" title="b.png" width="640" loading="lazy" decoding="async"\/>/);
  assert.match(html, /<span class="img-badge">이미지: none.png<\/span>/);
  assert.ok(!html.includes('wiki-embed'), html);
  // git 소스는 git 출처(gitRawPort)의 /raw/@…
  const pr = renderToStaticMarkup(createElement(Reader, { doc: doc('![[b.png|640]]', { links }), agent: false, src: { kind: 'pr', number: 7 }, gitRawPort: 8793, onNavigate: () => {} }));
  assert.match(pr, /<img src="http:\/\/localhost:8793\/raw\/@pr\/7\/outputs\/assets\/b.png"/);
});

test('원격 이미지는 요청하지 않는다 — 배지 + 외부 링크, 볼트 밖·절대경로는 배지만', () => {
  const html = renderLocal('![x](https://cdn.test/a.png)\n\n![y](../../out.png)\n\n![z](/etc/a.png)');
  assert.match(html, /<a class="img-badge-link" href="https:\/\/cdn.test\/a.png" target="_blank" rel="noreferrer"><span class="img-badge" title="x">이미지: https:\/\/cdn.test\/a.png<\/span><\/a>/);
  assert.match(html, /<span class="img-badge" title="y">이미지: ..\/..\/out.png<\/span>/);
  assert.match(html, /<span class="img-badge" title="z">이미지: \/etc\/a.png<\/span>/);
  assert.ok(!html.includes('<img'), html);
});

test('에이전트 모드: 볼트 이미지도 배지 그대로(이미지 바이트를 긁지 않는다)', () => {
  const links = [link('b.png', 'outputs/assets/b.png')];
  const html = renderLocal('![](a.png)\n\n![[b.png|640]]', { links }, true);
  assert.ok(!html.includes('<img'), html);
  assert.match(html, /<span class="img-badge">이미지: a.png<\/span>/);
  assert.match(html, /<span class="img-badge">이미지: b.png<\/span>/);
});

test('링크 안의 볼트 이미지는 새 탭 링크를 겹치지 않는다', () => {
  const html = renderLocal('[![](a.png)](https://x.test/)');
  assert.match(html, /<a href="https:\/\/x.test\/" target="_blank" rel="noreferrer"><img src="\/raw\/wiki\/a.png"/);
  assert.ok(!html.includes('img-open'), html);
});

test('임베드 본문 안의 이미지도 같은 규칙 — 실린 문서 기준으로 푼다', () => {
  const beta: DocEmbed = {
    status: 'ok',
    path: 'projects/x/beta.md',
    title: '베타',
    anchor: null,
    body: '![](shots/s.png)\n\n![[c.png|320]]',
    bodyStartLine: 1,
    headings: [],
    links: [link('c.png', 'projects/x/assets/c.png')],
  };
  const html = renderLocal('![[beta]]', { links: [link('beta', 'projects/x/beta.md')], embeds: { beta } });
  assert.match(html, /<img src="\/raw\/projects\/x\/shots\/s.png"/);
  assert.match(html, /<img src="\/raw\/projects\/x\/assets\/c.png" alt="" title="c.png" width="320"/);
});

test('노트 임베드: section.embed 에 제목 링크(같은 소스)와 본문 — 본문 안 임베드는 링크, 그 문서 기준으로 푼다', () => {
  const beta: DocEmbed = {
    status: 'ok',
    path: 'wiki/beta.md',
    title: '베타',
    anchor: null,
    body: '본문이다. [[gamma|감마]]\n\n![[host]]\n\n> [!note] 안쪽 callout\n> 본문\n\n```mermaid\ngraph TD; A-->B\n```',
    bodyStartLine: 4,
    headings: [],
    links: [link('gamma', 'wiki/gamma.md', false), link('host', 'wiki/host.md')],
  };
  const html = renderToStaticMarkup(
    createElement(Reader, {
      doc: doc('앞 문단\n\n![[beta]]\n\n뒤 문단', { links: [link('beta', 'wiki/beta.md')], embeds: { beta } }),
      agent: false,
      src: { kind: 'pr', number: 7 },
      onNavigate: () => {},
    }),
  );
  assert.match(html, /<div><section class="embed" data-embed-path="wiki\/beta.md"><p class="embed-title"><a href="\/v\/wiki\/beta.md\?src=pr:7"[^>]*>베타<\/a><\/p><div class="embed-body">/);
  assert.match(html, /<a href="\/v\/wiki\/gamma.md\?src=pr:7"[^>]*>감마<\/a>/);
  // 임베드 안의 임베드는 상자 없이 링크다.
  assert.match(html, /<a href="\/v\/wiki\/host.md\?src=pr:7"[^>]*>host<\/a>/);
  assert.equal(html.match(/<section class="embed"/g)?.length, 1);
  // 같은 파이프라인: callout·mermaid 그릇.
  assert.match(html, /<aside class="callout callout-note" data-callout="note">/);
  assert.match(html, /class="mermaid/);
});

test('노트 임베드 #절: 제목에 절 이름이 붙는다', () => {
  const sec: DocEmbed = { status: 'ok', path: 'wiki/beta.md', title: '베타', anchor: '둘째', body: '## 둘째\n\n절.', bodyStartLine: 9, headings: [], links: [] };
  const html = render('![[beta#둘째]]', { links: [{ ...link('beta', 'wiki/beta.md'), anchor: '둘째' }], embeds: { 'beta#둘째': sec } });
  assert.match(html, /<p class="embed-title"><a [^>]*>베타 › 둘째<\/a><\/p>/);
  // 임베드 본문의 제목에는 id 를 달지 않는다(바깥 문서 앵커와 겹치지 않게).
  assert.match(html, /<h2>둘째<\/h2>/);
});

test('안내 상자: 순환·자기 절·블록 참조·절 없음', () => {
  const circ = render('![[host]]', { links: [link('host', 'wiki/host.md')], embeds: { host: { status: 'circular', path: 'wiki/host.md' } } });
  assert.match(circ, /<section class="embed embed-notice embed-circular" data-embed-status="circular">/);
  assert.match(circ, /순환 임베드/);
  assert.match(render('![[#제목]]'), /embed-circular/);
  const block = render('![[beta#^abc]]', { links: [link('beta', 'wiki/beta.md')] });
  assert.match(block, /embed-block/);
  assert.match(block, /<a href="\/v\/wiki\/beta.md#\^abc"/);
  const none = render('![[beta#없음]]', {
    links: [link('beta', 'wiki/beta.md')],
    embeds: { 'beta#없음': { status: 'no-section', path: 'wiki/beta.md', title: '베타', anchor: '없음' } },
  });
  assert.match(none, /embed-no-section/);
  assert.match(none, /<code>#없음<\/code>/);
});

test('실린 본문이 없으면 [[target]] 과 같다 — 해석 못 하면 깨진 링크, 해석되면 링크', () => {
  assert.equal(render('![[nope]]'), render('[[nope]]').replace('<p>', '<div>').replace('</p>', '</div>'));
  assert.match(render('![[nope]]'), /<span class="link-dead" title="해석 안 됨: nope">nope<\/span>/);
  assert.match(render('![[beta]]', { links: [link('beta', 'wiki/beta.md')] }), /<div><a href="\/v\/wiki\/beta.md"/);
});

test('파일 임베드(pdf)와 문장 속 노트 임베드는 [[…]] 와 같은 링크다', () => {
  assert.equal(render('![[doc.pdf]]'), render('[[doc.pdf]]'));
  assert.equal(render('앞 ![[beta]] 뒤'), render('앞 [[beta]] 뒤'));
});

test('코드 스팬·코드 블록 안의 ![[…]] 와 [!note] 는 글자 그대로다', () => {
  const html = render('`![[img.png|460]]` 와 `> [!note]`\n\n```\n![[beta]]\n> [!warning]\n```');
  assert.match(html, /<code>!\[\[img.png\|460\]\]<\/code>/);
  assert.ok(!html.includes('img-badge') && !html.includes('<aside') && !html.includes('embed'), html);
});
