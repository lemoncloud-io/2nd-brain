import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyLink } from '../../src/reader/links.ts';
import { WIKILINK_SCHEME } from '../../src/reader/markdown.ts';

// 볼트 상대경로 → 원본 id. loader가 sources에서 만드는 표와 같은 모양이다.
const SOURCES = new Map<string, string>([
  ['projects/demo/docs/design.md', 'design'],
  ['projects/demo/docs/flow.md', 'flow'],
  ['projects/demo/notes/flow.md', 'note-flow'],
  ['projects/demo/config/viewer.yml', 'viewer'],
]);
const FROM = 'projects/demo/docs/design.md';

const wiki = (target: string) => `${WIKILINK_SCHEME}${target}`;

// 링크를 "만들지 않는" 판정. 이유가 비어 있으면 화면에서 왜 안 되는지 알 수 없다.
function assertNoLink(got: ReturnType<typeof classifyLink>, note: string): void {
  assert.equal(got.kind === 'missing' || got.kind === 'blocked', true, `링크가 만들어졌다: ${note}`);
  if (got.kind === 'missing' || got.kind === 'blocked') {
    assert.equal(got.reason.trim() !== '', true, `이유가 비어 있다: ${note}`);
  }
}

test('sources 안을 가리키는 위키링크는 internal이 된다 — 이름만·경로·확장자 세 형태', () => {
  for (const target of ['flow', 'projects/demo/docs/flow.md', 'projects/demo/docs/flow']) {
    assert.deepEqual(
      classifyLink(wiki(target), FROM, SOURCES),
      { kind: 'internal', source: 'flow' },
      `해소되지 않았다: ${target}`,
    );
  }
});

test('위키링크의 절은 검사기와 같은 슬러그로 바뀐다', () => {
  // 원문에는 헤딩 문구를 그대로 적는다. 슬러그로 바꾸지 않으면 그 절로 이동하지 못한다.
  assert.deepEqual(classifyLink(wiki('flow#검사 규칙'), FROM, SOURCES), {
    kind: 'internal',
    source: 'flow',
    slug: '검사-규칙',
  });
  assert.deepEqual(classifyLink(wiki('flow#검사 규칙|별칭'), FROM, SOURCES), {
    kind: 'internal',
    source: 'flow',
    slug: '검사-규칙',
  });
});

test('퍼센트 인코딩된 채로 들어온 주소도 같은 판정을 받는다', () => {
  // 렌더러(mdast-util-to-hast)는 주소의 한글·공백을 인코딩해서 넘긴다.
  const encoded = new Map(SOURCES).set('projects/demo/docs/한글 문서.md', 'korean');
  assert.deepEqual(classifyLink(wiki(encodeURI('한글 문서')), FROM, encoded), {
    kind: 'internal',
    source: 'korean',
  });
  assert.deepEqual(classifyLink(encodeURI('../docs/한글 문서.md#검사 규칙'), FROM, encoded), {
    kind: 'internal',
    source: 'korean',
    slug: '검사-규칙',
  });

  const got = classifyLink(wiki(encodeURI('없는 문서')), FROM, encoded);
  assertNoLink(got, '인코딩된 없는 문서');
  assert.equal(
    (got as { reason: string }).reason.includes('없는 문서'),
    true,
    `이유 문구가 인코딩된 채로 남았다: ${JSON.stringify(got)}`,
  );
});

test('sources 밖을 가리키는 위키링크는 링크를 만들지 않고 이유를 남긴다', () => {
  assertNoLink(classifyLink(wiki('없는문서'), FROM, SOURCES), '위키링크 범위 밖');
});

test('이름만 적은 위키링크가 여러 원본과 겹치면 먼저 등록된 원본으로 정해진다', () => {
  // 같은 입력에 같은 답이 나와야 한다(빌드가 결정적이어야 한다). sources의 등록 순서가 그 기준이다.
  assert.deepEqual(classifyLink(wiki('flow'), FROM, SOURCES), { kind: 'internal', source: 'flow' });

  const reordered = new Map([
    ['projects/demo/notes/flow.md', 'note-flow'],
    ['projects/demo/docs/flow.md', 'flow'],
  ]);
  assert.deepEqual(classifyLink(wiki('flow'), FROM, reordered), { kind: 'internal', source: 'note-flow' });
});

test('상대경로 링크는 현재 문서 자리에서 풀고 절의 슬러그를 붙인다', () => {
  assert.deepEqual(classifyLink('../config/viewer.yml', FROM, SOURCES), {
    kind: 'internal',
    source: 'viewer',
  });
  assert.deepEqual(classifyLink('../notes/flow.md#검사 규칙', FROM, SOURCES), {
    kind: 'internal',
    source: 'note-flow',
    slug: '검사-규칙',
  });
  assert.deepEqual(classifyLink('./flow.md', FROM, SOURCES), { kind: 'internal', source: 'flow' });
});

test('상대경로가 sources 밖이면 링크를 만들지 않는다', () => {
  const got = classifyLink('../docs/없는문서.md', FROM, SOURCES);
  assertNoLink(got, '상대경로 범위 밖');
  assert.equal((got as { reason: string }).reason.includes('없는문서'), true);
});

test('http·https는 external이고 그 밖의 스킴은 링크를 만들지 않는다', () => {
  assert.deepEqual(classifyLink('https://example.com/a', FROM, SOURCES), { kind: 'external' });
  assert.deepEqual(classifyLink('http://example.com/a', FROM, SOURCES), { kind: 'external' });

  for (const href of [
    'mailto:someone@example.com',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,x',
  ]) {
    assertNoLink(classifyLink(href, FROM, SOURCES), href);
  }
});

test('같은 문서 안의 #절은 same-doc이고 슬러그로 바뀐다', () => {
  assert.deepEqual(classifyLink('#검사 규칙', FROM, SOURCES), { kind: 'same-doc', slug: '검사-규칙' });
  assert.deepEqual(classifyLink('#검사-규칙', FROM, SOURCES), { kind: 'same-doc', slug: '검사-규칙' });
  assert.deepEqual(classifyLink(wiki('#검사 규칙'), FROM, SOURCES), { kind: 'same-doc', slug: '검사-규칙' });
});

test('줄 앵커(#L12)는 슬러그로 뭉개지 않고 그대로 둔다', () => {
  // 코드·데이터 원본은 절이 아니라 줄 번호로 이동한다. 소문자로 바뀌면 그 자리를 찾지 못한다.
  assert.deepEqual(classifyLink('#L12', FROM, SOURCES), { kind: 'same-doc', slug: 'L12' });
  assert.deepEqual(classifyLink('../config/viewer.yml#L7', FROM, SOURCES), {
    kind: 'internal',
    source: 'viewer',
    slug: 'L7',
  });
});

test('절대경로와 볼트 밖으로 나가는 상대경로는 링크를 만들지 않는다', () => {
  for (const href of ['/etc/passwd', '/projects/demo/docs/flow.md', '../../../../outside.md']) {
    assertNoLink(classifyLink(href, FROM, SOURCES), href);
  }
});

test('빈 링크는 링크를 만들지 않는다', () => {
  assertNoLink(classifyLink('', FROM, SOURCES), '빈 주소');
  assertNoLink(classifyLink('   ', FROM, SOURCES), '공백 주소');
});
