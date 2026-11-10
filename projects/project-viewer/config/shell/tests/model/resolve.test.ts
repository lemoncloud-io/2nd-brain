import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Heading } from '../../model/types.ts';
import { extractHeadings } from '../../model/slug.ts';
import { nearestHeadings, resolveRef, stripInlineMarkup } from '../../model/resolve.ts';

// 줄 번호를 단언하므로 본문은 줄 단위로 조립한다.
const BODY = [
  /*  1 */ '머리말 문장은 헤딩 위쪽에 있다.',
  /*  2 */ '',
  /*  3 */ '# 사양',
  /*  4 */ '',
  /*  5 */ '첫 문단.',
  /*  6 */ '',
  /*  7 */ '## 진실원 규칙',
  /*  8 */ '',
  /*  9 */ '규칙 본문. 유일한 문구.',
  /* 10 */ '',
  /* 11 */ '## 되풀이 헤딩',
  /* 12 */ '',
  /* 13 */ '두 번 나오는 문구.',
  /* 14 */ '',
  /* 15 */ '## 되풀이 헤딩',
  /* 16 */ '',
  /* 17 */ '두 번 나오는 문구.',
  /* 18 */ '',
  /* 19 */ '```text',
  /* 20 */ '코드펜스 안 문구.',
  /* 21 */ '```',
].join('\n');

const HEADINGS = extractHeadings(BODY);

test('형태가 없는 참조는 문서 전체를 뜻하고 그대로 통과한다', () => {
  const r = resolveRef({}, BODY, HEADINGS);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.line, undefined);
  assert.equal(r.ok && r.slug, undefined);
});

test('at은 헤딩 평문과 정확히 일치하면 슬러그와 줄을 준다', () => {
  const r = resolveRef({ at: '  진실원 규칙 ' }, BODY, HEADINGS);
  assert.deepEqual(r, { ok: true, slug: '진실원-규칙', line: 7 });
});

test('at에 없는 헤딩을 주면 실패한다', () => {
  const r = resolveRef({ at: '없는 헤딩' }, BODY, HEADINGS);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.reason : '', /헤딩/);
});

test('같은 문구의 헤딩이 여럿이면 at은 실패한다', () => {
  const r = resolveRef({ at: '되풀이 헤딩' }, BODY, HEADINGS);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.reason : '', /2/);
});

test('lines 범위는 파일 안이어야 한다', () => {
  assert.deepEqual(resolveRef({ lines: '5-9' }, BODY, HEADINGS), { ok: true, slug: '사양', line: 5 });
  assert.equal(resolveRef({ lines: '22' }, BODY, HEADINGS).ok, false);
  assert.equal(resolveRef({ lines: '0' }, BODY, HEADINGS).ok, false);
});

test('lines가 역전(9-3)이면 실패한다', () => {
  const r = resolveRef({ lines: '9-3' }, BODY, HEADINGS);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.reason : '', /범위/);
});

test('find가 한 곳에서만 나오면 성공한다', () => {
  assert.deepEqual(resolveRef({ find: '유일한 문구' }, BODY, HEADINGS), {
    ok: true,
    slug: '진실원-규칙',
    line: 9,
  });
});

test('find가 0곳이면 실패한다', () => {
  const r = resolveRef({ find: '원문에 없는 문구' }, BODY, HEADINGS);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.reason : '', /0/);
});

test('find가 2곳이면 실패한다', () => {
  const r = resolveRef({ find: '두 번 나오는 문구' }, BODY, HEADINGS);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.reason : '', /2/);
});

test('find는 코드펜스 안도 찾는다', () => {
  assert.deepEqual(resolveRef({ find: '코드펜스 안 문구' }, BODY, HEADINGS), {
    ok: true,
    slug: '되풀이-헤딩-1',
    line: 20,
  });
});

test('find가 첫 헤딩 위쪽이면 슬러그가 없다', () => {
  assert.deepEqual(resolveRef({ find: '머리말 문장' }, BODY, HEADINGS), {
    ok: true,
    slug: undefined,
    line: 1,
  });
});

test('at·lines·find는 함께 쓸 수 없다', () => {
  const r = resolveRef({ at: '사양', find: '첫 문단' }, BODY, HEADINGS);
  assert.equal(r.ok, false);
});

// ── 미해소 at의 후보 제시 ────────────────────────────────────────────────────

// 표기가 든 헤딩과 서로 닮은 헤딩을 담았다. 후보를 고르는 규칙만 본다.
const HINT_BODY = [
  '# 구현 레인은 둘이다 — `track:`',
  '',
  '본문.',
  '',
  '## 진실원 규칙',
  '',
  '본문.',
  '',
  '## 진실원 규칙 부록',
  '',
  '본문.',
  '',
  '## 진실원 규칙과 예외',
  '',
  '본문.',
].join('\n');

const HINT_HEADINGS = extractHeadings(HINT_BODY);

function heads(...texts: string[]): Heading[] {
  return texts.map((text, i) => ({ depth: 2, text, slug: `h${i}`, line: i + 1 }));
}

test('표기만 다른 at은 표기를 뗀 헤딩을 알려 준다', () => {
  const r = resolveRef({ at: '구현 레인은 둘이다 — `track:`' }, HINT_BODY, HINT_HEADINGS);
  assert.equal(r.ok, false);
  assert.equal(
    !r.ok ? r.reason : '',
    '그런 헤딩이 없다: 구현 레인은 둘이다 — `track:`' +
      ' — 표기를 뗀 "구현 레인은 둘이다 — track:"이 있다.' +
      ' at은 헤딩의 평문과 비교한다(백틱·굵게·링크 표기 제거)',
  );
});

test('오탈자 at에는 가까운 헤딩이 점수순으로 최대 2개 붙는다', () => {
  const r = resolveRef({ at: '진실원 규칙들' }, HINT_BODY, HINT_HEADINGS);
  assert.equal(
    !r.ok ? r.reason : '',
    '그런 헤딩이 없다: 진실원 규칙들 — 가까운 헤딩: "진실원 규칙", "진실원 규칙 부록"',
  );
});

test('후보가 하나면 하나만 붙는다', () => {
  const r = resolveRef({ at: '진실원 규치' }, BODY, HEADINGS);
  assert.equal(!r.ok ? r.reason : '', '그런 헤딩이 없다: 진실원 규치 — 가까운 헤딩: "진실원 규칙"');
});

test('닮은 헤딩이 없으면 메시지가 그대로다', () => {
  const r = resolveRef({ at: '없는 헤딩' }, BODY, HEADINGS);
  assert.equal(!r.ok ? r.reason : '', '그런 헤딩이 없다: 없는 헤딩');
});

test('같은 문구의 헤딩이 여럿이면 후보를 붙이지 않는다', () => {
  const r = resolveRef({ at: '되풀이 헤딩' }, BODY, HEADINGS);
  assert.equal(!r.ok ? r.reason : '', '같은 문구의 헤딩이 2개다: 되풀이 헤딩');
});

test('stripInlineMarkup은 인라인 표기를 뗀다', () => {
  assert.equal(stripInlineMarkup('구현 레인은 둘이다 — `track:`'), '구현 레인은 둘이다 — track:');
  assert.equal(stripInlineMarkup('**굵게**와 _기울임_과 ~~취소선~~'), '굵게와 기울임과 취소선');
  assert.equal(stripInlineMarkup('## 검사 규칙'), '검사 규칙');
  assert.equal(stripInlineMarkup('[문서](docs/a.md) 참고'), '문서 참고');
  assert.equal(stripInlineMarkup('[[note-slug|별칭]]과 [[note-slug]]'), '별칭과 note-slug');
  assert.equal(stripInlineMarkup('가   나'), '가 나');
});

test('nearestHeadings는 공백을 떼고 견준다', () => {
  assert.deepEqual(
    nearestHeadings('진실원  규칙', heads('진실원 규칙')).map((h) => h.text),
    ['진실원 규칙'],
  );
});

test('nearestHeadings는 동점이면 문서 순서를 지킨다', () => {
  assert.deepEqual(
    nearestHeadings('가나다라', heads('가나다라마', '가나다라바')).map((h) => h.text),
    ['가나다라마', '가나다라바'],
  );
});

test('nearestHeadings는 유사도 0.5 미만을 버린다', () => {
  // Dice = 2·1/(2+2) = 0.5 → 넣는다. 2·1/(2+3) = 0.4 → 뺀다.
  assert.deepEqual(
    nearestHeadings('abc', heads('bcd', 'bcde')).map((h) => h.text),
    ['bcd'],
  );
});

test('nearestHeadings의 max는 개수를 자른다', () => {
  assert.equal(nearestHeadings('진실원 규칙들', HINT_HEADINGS, 1).length, 1);
});
