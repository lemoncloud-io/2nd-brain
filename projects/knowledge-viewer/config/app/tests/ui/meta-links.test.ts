// 문서 정보 패널 frontmatter 링크: 값 조각 나누기(위키링크·md 링크·경로·URL·$GITHUB_DIR·글), 후보 고르기, 패널 SSR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import { LOCAL } from '../../shared/source.ts';
import type { DocLink, DocResponse } from '../../src/app/types.ts';
import { codePathCandidates } from '../../src/reader/code-paths.ts';
import { META_KEYS, githubDirUrl, mdLinkAccepts, metaItems, metaPathCandidates, parseMetaValue } from '../../src/reader/meta-links.ts';

const { MetaPanel } = await import('../../src/reader/MetaPanel.tsx');

test('parseMetaValue: 위키링크 — 맨 대상·별칭·앵커(별칭 없으면 괄호 안 글 그대로)', () => {
  assert.deepEqual(parseMetaValue('[[projects/demo-lib/docs/high-levels]]'), [
    { kind: 'wiki', text: 'projects/demo-lib/docs/high-levels', target: 'projects/demo-lib/docs/high-levels', anchor: '' },
  ]);
  assert.deepEqual(parseMetaValue('[[a/b|별칭]]'), [{ kind: 'wiki', text: '별칭', target: 'a/b', anchor: '' }]);
  assert.deepEqual(parseMetaValue('[[a/b#절 하나]]'), [{ kind: 'wiki', text: 'a/b#절 하나', target: 'a/b', anchor: '절 하나' }]);
  assert.deepEqual(parseMetaValue('[[a/b#절|별칭]]'), [{ kind: 'wiki', text: '별칭', target: 'a/b', anchor: '절' }]);
  // 대상이 비면(`[[#절]]`) 글 그대로다.
  assert.deepEqual(parseMetaValue('[[#절]]'), [{ kind: 'text', text: '[[#절]]' }]);
});

test('parseMetaValue: $GITHUB_DIR — owner/repo 만이면 저장소, 뒤 경로는 tree/HEAD, 꼬리 글은 그대로', () => {
  assert.deepEqual(parseMetaValue('$GITHUB_DIR/acme/core (develop e4ba0c9b, 4.3.0)'), [
    { kind: 'url', text: '$GITHUB_DIR/acme/core', url: 'https://github.com/acme/core' },
    { kind: 'text', text: ' (develop e4ba0c9b, 4.3.0)' },
  ]);
  assert.equal(githubDirUrl('$GITHUB_DIR/o/r/src/a b.ts'), 'https://github.com/o/r/tree/HEAD/src/a%20b.ts');
  assert.equal(githubDirUrl('$GITHUB_DIR/o/r/'), 'https://github.com/o/r');
  assert.equal(githubDirUrl('$GITHUB_DIR/o'), null);
  assert.equal(githubDirUrl('$GITHUB_DIR/o!x/r'), null);
  assert.equal(githubDirUrl('$GITHUB_DIR/../r'), null);
  assert.deepEqual(parseMetaValue('$GITHUB_DIR/o~x/r (main)'), [{ kind: 'text', text: '$GITHUB_DIR/o~x/r (main)' }]);
});

test('parseMetaValue: URL·맨 경로·글, 둘러싼 따옴표·괄호·문장 부호는 글로 남는다', () => {
  assert.deepEqual(parseMetaValue('https://example.com/a?b=1'), [{ kind: 'url', text: 'https://example.com/a?b=1', url: 'https://example.com/a?b=1' }]);
  assert.deepEqual(parseMetaValue('raw/2026-10-01-note.md'), [{ kind: 'path', text: 'raw/2026-10-01-note.md' }]);
  assert.deepEqual(parseMetaValue('"raw/x.md"'), [
    { kind: 'text', text: '"' },
    { kind: 'path', text: 'raw/x.md' },
    { kind: 'text', text: '"' },
  ]);
  // 값 전체가 출처 문자열이면 빈칸·괄호가 들어도 경로 하나다(원본 이름은 제목이다).
  assert.deepEqual(parseMetaValue('raw/4 Free Tools (No Plan Upgrade Needed).md'), [{ kind: 'path', text: 'raw/4 Free Tools (No Plan Upgrade Needed).md' }]);
  assert.deepEqual(parseMetaValue('"raw/Title: sub #1.md"'), [
    { kind: 'text', text: '"' },
    { kind: 'path', text: 'raw/Title: sub #1.md' },
    { kind: 'text', text: '"' },
  ]);
  // 값 일부면 낱말 규칙 그대로다 — 낱말마다 후보다(있는 것만 링크가 된다).
  assert.deepEqual(parseMetaValue('see raw/a b.md'), [
    { kind: 'text', text: 'see ' },
    { kind: 'path', text: 'raw/a' },
    { kind: 'text', text: ' ' },
    { kind: 'path', text: 'b.md' },
  ]);
  assert.deepEqual(parseMetaValue('그냥 글이다'), [{ kind: 'text', text: '그냥 글이다' }]);
  assert.deepEqual(parseMetaValue('ftp://x/y'), [{ kind: 'text', text: 'ftp://x/y' }]);
  assert.deepEqual(parseMetaValue('javascript:alert(1)'), [{ kind: 'text', text: 'javascript:alert(1)' }]);
});

test('parseMetaValue: md 링크 — 상대 경로·앵커, http 는 바깥, 스킴·앵커만은 글', () => {
  assert.deepEqual(parseMetaValue('[노트](../a/b%20c.md#x)'), [{ kind: 'md', text: '노트', target: '../a/b c.md', anchor: 'x' }]);
  assert.deepEqual(parseMetaValue('[사이트](https://x.io/p)'), [{ kind: 'url', text: '사이트', url: 'https://x.io/p' }]);
  assert.deepEqual(parseMetaValue('[메일](mailto:a@b.c)'), [{ kind: 'text', text: '메일' }]);
  assert.deepEqual(parseMetaValue('[절](#x)'), [{ kind: 'text', text: '절' }]);
});

test('parseMetaValue: 섞인 글 — 위키링크·경로·URL·글이 차례대로', () => {
  assert.deepEqual(parseMetaValue('근거 [[wiki/x|X]] 와 raw/y.md, 참고 (https://e.com).'), [
    { kind: 'text', text: '근거 ' },
    { kind: 'wiki', text: 'X', target: 'wiki/x', anchor: '' },
    { kind: 'text', text: ' 와 ' },
    { kind: 'path', text: 'raw/y.md' },
    { kind: 'text', text: ', 참고 (' },
    { kind: 'url', text: 'https://e.com', url: 'https://e.com/' },
    { kind: 'text', text: ').' },
  ]);
});

test('metaItems: 문자열만 parse, 숫자·불·객체는 글 그대로', () => {
  assert.deepEqual(metaItems(['a/b.md', 3, true, { k: 1 }, null, '']), [
    { text: 'a/b.md', parse: true },
    { text: '3', parse: false },
    { text: 'true', parse: false },
    { text: '{"k":1}', parse: false },
  ]);
});

test('metaPathCandidates: 패널 키의 경로·md 링크만, 겹침 없이 — 본문 후보 앞에 붙는다', () => {
  const fm = {
    sources: ['raw/a.md', 'raw/b c.md', '[[wiki/x]]', '[n](../b.md)', 'raw/a.md', 'https://e.com/c.md', '$GITHUB_DIR/o/r'],
    related: 'projects/p/README.md',
    other: 'not/shown.md',
  };
  const c = metaPathCandidates(fm, META_KEYS);
  assert.deepEqual(c, ['projects/p/README.md', 'raw/a.md', 'raw/b c.md', '../b.md']);
  assert.deepEqual(codePathCandidates('`raw/a.md` `docs/`', c), ['projects/p/README.md', 'raw/a.md', 'raw/b c.md', '../b.md', 'docs/']);
});

test('mdLinkAccepts: 문서 폴더 기준 경로와 같을 때만(루트 기준으로 찾은 것은 받지 않는다)', () => {
  assert.equal(mdLinkAccepts('wiki/topics/t.md', '../INDEX.md', 'wiki/INDEX.md'), true);
  assert.equal(mdLinkAccepts('wiki/topics/t.md', 'raw/a.md', 'raw/a.md'), false);
  assert.equal(mdLinkAccepts('wiki/topics/t.md', 'sub/', 'wiki/topics/sub'), true);
});

const link = (target: string, path: string | null): DocLink => ({ kind: 'wiki', target, anchor: null, label: target, line: 2, embed: false, path, candidates: [] });

const doc = (frontmatter: Record<string, unknown>, links: DocLink[]): DocResponse => ({
  source: 'local',
  head: null,
  path: 'projects/demo-lib/README.md',
  title: 'doc',
  frontmatter,
  body: '',
  bodyStartLine: 1,
  headings: [],
  links,
  backlinks: [],
  stamp: { commit: 'abc1234', dirty: false },
  mtime: 0,
  ignored: false,
});

test('MetaPanel: 푼 위키링크는 앱 안 링크, 못 푼 것은 끊긴 링크 모양, 경로는 찾은 것만, GitHub·URL 은 새 탭', () => {
  const d = doc(
    {
      type: 'project',
      status: 3,
      sources: [
        '[[projects/demo-lib/docs/high-levels]]',
        '[[projects/demo-lib/outputs/none|없는 것]]',
        '[[projects/demo-lib/docs/high-levels#절|절 별칭]]',
        '$GITHUB_DIR/acme/core (develop e4ba0c9b, 4.3.0)',
        'raw/a.md',
        'raw/missing.md',
        '[상대](docs/x.md#y)',
        'https://example.com/z',
      ],
    },
    [link('projects/demo-lib/docs/high-levels', 'projects/demo-lib/docs/high-levels.md'), link('projects/demo-lib/outputs/none', null)],
  );
  const html = renderToStaticMarkup(
    createElement(MetaPanel, {
      doc: d,
      agent: false,
      src: LOCAL,
      onNavigate: () => {},
      paths: {
        'raw/a.md': { path: 'raw/a.md', kind: 'md' },
        'raw/missing.md': null,
        'docs/x.md': { path: 'projects/demo-lib/docs/x.md', kind: 'md' },
      },
    }),
  );
  assert.match(
    html,
    /<li><a href="\/v\/projects\/demo-lib\/docs\/high-levels\.md\?src=local" data-vault-path="projects\/demo-lib\/docs\/high-levels\.md">projects\/demo-lib\/docs\/high-levels<\/a><\/li>/,
  );
  assert.match(html, /<span class="link-dead" title="해석 안 됨: projects\/demo-lib\/outputs\/none">없는 것<\/span>/);
  assert.match(html, /<a href="\/v\/projects\/demo-lib\/docs\/high-levels\.md\?src=local#절"[^>]*>절 별칭<\/a>/);
  assert.match(
    html,
    /<li><a href="https:\/\/github\.com\/acme\/core" target="_blank" rel="noreferrer">\$GITHUB_DIR\/acme\/core<\/a> \(develop e4ba0c9b, 4\.3\.0\)<\/li>/,
  );
  assert.match(html, /<li><a href="\/v\/raw\/a\.md\?src=local" data-vault-path="raw\/a\.md">raw\/a\.md<\/a><\/li>/);
  assert.match(html, /<li>raw\/missing\.md<\/li>/);
  assert.match(html, /<a href="\/v\/projects\/demo-lib\/docs\/x\.md\?src=local#y"[^>]*>상대<\/a>/);
  assert.match(html, /<a href="https:\/\/example\.com\/z" target="_blank" rel="noreferrer">https:\/\/example\.com\/z<\/a>/);
  // 한 값이면 목록 없이 dd 바로, 숫자는 글 그대로.
  assert.match(html, /<dt>type<\/dt><dd>project<\/dd>/);
  assert.match(html, /<dt>status<\/dt><dd>3<\/dd>/);
});

test('MetaPanel: 찾은 곳 표가 없으면(묻는 중) 경로는 글, 위키링크는 doc.links 로 바로 링크', () => {
  const d = doc({ sources: ['raw/a.md', '[[wiki/x]]'] }, [link('wiki/x', 'wiki/x.md')]);
  const html = renderToStaticMarkup(createElement(MetaPanel, { doc: d, agent: true, src: LOCAL, onNavigate: () => {} }));
  assert.match(html, /<li>raw\/a\.md<\/li>/);
  assert.match(html, /<a href="\/v\/wiki\/x\.md\?agent=claude&amp;src=local" data-vault-path="wiki\/x\.md">wiki\/x<\/a>/);
});
