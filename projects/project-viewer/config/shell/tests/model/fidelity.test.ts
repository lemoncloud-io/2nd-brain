import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Block, GlossaryTerm, ViewerDoc } from '../../model/types.ts';
import {
  checkFidelity,
  collectExplanations,
  normalizeForFidelity,
  numberContexts,
  splitSentences,
} from '../../model/fidelity.ts';

// ── 조립기 ───────────────────────────────────────────────────────────────────
function viewer(blocks: Block[], glossary: GlossaryTerm[] = [], sourceIds: string[] = ['a']): ViewerDoc {
  return {
    schema_version: 1,
    meta: { title: '데모', kind: 'explainer' },
    sources: sourceIds.map((id) => ({ id, path: `docs/${id}.md`, role: 'primary', kind: 'doc' as const })),
    glossary,
    pages: [{ id: 'P1', title: '개요', blocks }],
  };
}

function prose(text: string, source = 'a'): Block {
  return { type: 'prose', id: 'B1', text, evidence: [{ source }] };
}

function judge(text: string, docs: Record<string, string>, source = 'a', sourceIds = Object.keys(docs)) {
  const ids = sourceIds.includes(source) ? sourceIds : [...sourceIds, source];
  return checkFidelity({ viewer: viewer([prose(text, source)], [], ids), docs: new Map(Object.entries(docs)) });
}

// ── normalizeForFidelity ─────────────────────────────────────────────────────
test('줄 머리 날짜는 목록 표지가 아니다', () => {
  assert.equal(normalizeForFidelity('2026-09-17 회차에 있다'), '2026-09-17회차에있다');
  assert.equal(normalizeForFidelity('3-1 항목이다'), '3-1항목이다');
});

test('줄 머리 목록 표지만 지운다', () => {
  assert.equal(normalizeForFidelity('- 첫째 줄'), '첫째줄');
  assert.equal(normalizeForFidelity('1. 첫째 줄'), '첫째줄');
  assert.equal(normalizeForFidelity('12. 첫째 줄'), '첫째줄');
  assert.equal(normalizeForFidelity('  + 들여쓴 줄'), '들여쓴줄');
  assert.equal(normalizeForFidelity('앞말 - 뒷말'), '앞말-뒷말');
});

test('<br/>로 끊긴 mermaid 문구는 이어 붙인 문장과 같아진다', () => {
  assert.equal(normalizeForFidelity('요청 수집<br/>뒤 판정'), normalizeForFidelity('요청 수집 뒤 판정'));
  assert.equal(normalizeForFidelity('가<br>나'), '가나');
  assert.equal(normalizeForFidelity('가<br />나'), '가나');
});

test('링크 표기는 보이는 글자만 남긴다', () => {
  assert.equal(normalizeForFidelity('[[wiki-slug|별칭]]'), '별칭');
  assert.equal(normalizeForFidelity('[[wiki-slug]]'), 'wiki-slug');
  assert.equal(normalizeForFidelity('[제목](https://example.com/a)'), '제목');
});

test('표 구분자·인용 접두·백틱·강조는 지운다', () => {
  assert.equal(normalizeForFidelity('| 칸 | 다른 칸 |'), '칸다른칸');
  assert.equal(normalizeForFidelity('> 인용한 줄이다'), '인용한줄이다');
  assert.equal(normalizeForFidelity('`코드` **굵게** _기울임_'), '코드굵게기울임');
  assert.equal(normalizeForFidelity('## 헤딩이다'), '헤딩이다');
});

test('공백과 줄바꿈은 모두 지운다', () => {
  assert.equal(normalizeForFidelity('여러 줄로\n  이어진다\n'), '여러줄로이어진다');
});

// ── splitSentences ───────────────────────────────────────────────────────────
test('문장은 마침표·줄바꿈·"다" 뒤에서 나뉜다', () => {
  assert.deepEqual(splitSentences('하나다. 둘이다.'), ['하나다.', '둘이다.']);
  assert.deepEqual(splitSentences('하나다.\n둘이다.'), ['하나다.', '둘이다.']);
  assert.deepEqual(splitSentences('먼저 한다 그리고 다음이다.'), ['먼저 한다', '그리고 다음이다.']);
  assert.deepEqual(splitSentences('묻는다? 외친다! 끝.'), ['묻는다?', '외친다!', '끝.']);
  assert.deepEqual(splitSentences('안 나뉜다'), ['안 나뉜다']);
});

// ── collectExplanations ──────────────────────────────────────────────────────
const RICH: Block[] = [
  {
    type: 'graph',
    id: 'G',
    title: '이름표다',
    intro: '블록 도입이다.',
    evidence: [{ source: 'a' }],
    nodes: [
      { id: 'n1', label: '이름표다', tag: '태그다', easy: '쉬운 설명이다.', tech: '기술 설명이다.', evidence: [{ source: 'b' }] },
      { id: 'n2', label: '이름표다', easy: '물려받는 설명이다.', fields: [{ label: '주의', text: '칸 설명이다.' }] },
    ],
  },
  {
    type: 'stages',
    id: 'S',
    evidence: [{ source: 'a' }],
    stages: [
      {
        id: 's1',
        title: '이름표다',
        short: '짧은 이름',
        owner: '주인',
        question: '무엇을 묻나.',
        output: '무엇이 나오나.',
        detail: { source: 'c', at: '절' },
        items: [{ id: 's1.i1', label: '이름표다', criteria: '기준이다.' }],
      },
    ],
  },
  {
    type: 'table',
    id: 'T',
    evidence: [{ source: 'a' }],
    columns: [{ id: 'c1', label: '열 이름' }, { id: 'c2', label: '다른 열' }],
    rows: [
      {
        id: 'r1',
        evidence: [{ source: 'b' }],
        cells: { c1: '문자열 셀이다.', c2: { text: '객체 셀이다.', evidence: [{ source: 'c' }] } },
      },
      { id: 'r2', cells: { c1: '물려받는 셀이다.', c2: '  ' } },
    ],
  },
  { type: 'prose', id: 'P', text: '산문이다.', evidence: [{ source: 'a' }] },
];

const TERMS: GlossaryTerm[] = [
  { id: 't1', term: '이름표다', easy: '용어 쉬운 설명이다.', tech: '용어 기술 설명이다.', evidence: [{ source: 'c' }] },
];

test('해설 필드만 모으고 이름표는 빼놓는다', () => {
  const found = collectExplanations(viewer(RICH, TERMS, ['a', 'b', 'c']));
  const texts = found.map((f) => f.text);
  for (const label of ['이름표다', '태그다', '짧은 이름', '주인', '열 이름', '다른 열', '주의']) {
    assert.ok(!texts.includes(label), `이름표가 섞였다: ${label}`);
  }
  assert.deepEqual(
    texts,
    [
      '블록 도입이다.',
      '쉬운 설명이다.',
      '기술 설명이다.',
      '물려받는 설명이다.',
      '칸 설명이다.',
      '무엇을 묻나.',
      '무엇이 나오나.',
      '기준이다.',
      '문자열 셀이다.',
      '객체 셀이다.',
      '물려받는 셀이다.',
      '산문이다.',
      '용어 쉬운 설명이다.',
      '용어 기술 설명이다.',
    ],
  );
});

test('근거는 자기 → 블록, 단계는 detail, 표 셀은 셀 → 행 → 블록 순으로 물려받는다', () => {
  const found = collectExplanations(viewer(RICH, TERMS, ['a', 'b', 'c']));
  const at = (text: string) => found.find((f) => f.text === text)!;
  assert.deepEqual(at('블록 도입이다.').sources, ['a']);
  assert.deepEqual(at('쉬운 설명이다.').sources, ['b']); // 자기 근거
  assert.deepEqual(at('물려받는 설명이다.').sources, ['a']); // 블록 근거
  assert.deepEqual(at('무엇을 묻나.').sources, ['c']); // 단계 detail
  assert.deepEqual(at('기준이다.').sources, ['c']); // 단계 항목은 detail을 물려받는다
  assert.deepEqual(at('객체 셀이다.').sources, ['c']); // 셀 근거
  assert.deepEqual(at('문자열 셀이다.').sources, ['b']); // 행 근거
  assert.deepEqual(at('물려받는 셀이다.').sources, ['a']); // 블록 근거
  assert.deepEqual(at('용어 쉬운 설명이다.').sources, ['c']);
  assert.equal(at('블록 도입이다.').where, 'pages[0].blocks[0].intro');
  assert.equal(at('쉬운 설명이다.').where, 'pages[0].blocks[0].nodes[0].easy');
  assert.equal(at('기준이다.').where, 'pages[0].blocks[1].stages[0].items[0].criteria');
  assert.equal(at('객체 셀이다.').where, 'pages[0].blocks[2].rows[0].cells.c2');
  assert.equal(at('용어 쉬운 설명이다.').where, 'glossary[0].easy');
});

// ── checkFidelity ────────────────────────────────────────────────────────────
const SENT = '결정은 2026-09-17 회차까지 보류한다.';
const BODY = ['# 원본', '', '앞 문단이다.', '', SENT, '', '뒤 문단이다.', ''].join('\n');

// 창 40개짜리 문장 — 85% 경계를 자릿수 없이 만든다(49자, 10자 창).
const LONG = Array.from({ length: 49 }, (_, i) => String.fromCharCode(0xac00 + i * 7)).join('');

test('근거로 건 원본에 그대로 있으면 완전 일치다', () => {
  const r = judge(SENT, { a: BODY });
  assert.equal(r.strings, 1);
  assert.equal(r.sentences, 1);
  assert.equal(r.exact, 1);
  assert.deepEqual(r.issues, []);
});

test('10자 창 85%는 다듬음, 그 아래는 미일치다', () => {
  const above = judge(LONG, { a: LONG.slice(0, 43) });
  assert.equal(above.trimmed, 1);
  assert.equal(above.missing, 0);

  const below = judge(LONG, { a: LONG.slice(0, 42) });
  assert.equal(below.trimmed, 0);
  assert.equal(below.missing, 1);
  assert.equal(below.issues.length, 1);
  assert.equal(below.issues[0]!.code, 'E_FIDELITY');
  assert.equal(below.issues[0]!.level, 'error');
  assert.equal(below.issues[0]!.where, 'pages[0].blocks[0].text');
  assert.match(below.issues[0]!.message, /^원본 어디에도 없는 문장이다\(일치 83%\): /);
});

test('근거로 걸지 않은 다른 원본에 있으면 경고 한 건이다', () => {
  const r = judge(SENT, { a: '아무 상관 없는 본문이다.', b: BODY }, 'a', ['a', 'b']);
  assert.equal(r.elsewhere, 1);
  assert.equal(r.exact, 0);
  assert.equal(r.missing, 0);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0]!.code, 'W_FIDELITY_ELSEWHERE');
  assert.equal(r.issues[0]!.level, 'warning');
  assert.equal(r.issues[0]!.message, `근거로 건 원본이 아닌 곳(b)에 있다: ${SENT}`);
});

test('정규화 길이 8 미만인 문장은 세지 않는다', () => {
  const r = judge('짧다.', { a: '아무 본문이다.' });
  assert.equal(r.strings, 1);
  assert.equal(r.sentences, 0);
  assert.deepEqual(r.issues, []);
});

test('근거 원본의 본문이 하나도 없으면 건너뛴다', () => {
  const r = judge(SENT, { b: BODY }, 'a', ['a', 'b']);
  assert.equal(r.sentences, 1);
  assert.equal(r.skipped, 1);
  assert.equal(r.exact, 0);
  assert.deepEqual(r.issues, []);
});

test('변이 3종은 완전 일치로 통과하지 못한다', () => {
  const same = judge(SENT, { a: BODY });
  assert.equal(same.exact, 1, '대조군은 완전 일치여야 한다');

  const made = judge('이 문장은 원본에 없고 지어낸 것이다.', { a: BODY });
  assert.equal(made.exact, 0);
  assert.equal(made.missing, 1);

  const digit = judge('결정은 2026-09-18 회차까지 보류한다.', { a: BODY });
  assert.equal(digit.exact, 0);
  assert.equal(digit.missing, 1);

  const flipped = judge('결정은 2026-09-17 회차까지 즉시 채택한다.', { a: BODY });
  assert.equal(flipped.exact, 0);
  assert.equal(flipped.trimmed, 0);
});

// ── 보완 조항 A1: 숫자 문맥 가드와 다듬음 나열 ───────────────────────────────
const syl = (i: number): string => String.fromCharCode(0xac00 + i * 7);
const block = (from: number, count: number): string => Array.from({ length: count }, (_, i) => syl(from + i)).join('');

// 90자 문장 한가운데 날짜가 있다 — 한 글자를 바꿔도 창은 88%라서 그냥은 통과한다.
const DATED = `${block(0, 40)}2026-09-17${block(50, 40)}`;
const DATED_DOC = ['# 원본', '', DATED, ''].join('\n');
// 20자 문장 맨 앞의 숫자 — 창 하나만 깨진다(91%).
const HEADED = `5${block(100, 19)}`;
const HEADED_DOC = ['# 원본', '', HEADED, ''].join('\n');
// 창은 다 맞지만 문장 전체는 없는 경우 — 덮이지 않은 글자가 없다.
const SPLIT = block(150, 30);
const SPLIT_DOC = `${SPLIT.slice(0, 22)}XYZW${SPLIT.slice(13)}`;

test('숫자 덩이는 구분 기호로 이어진 한 덩이다', () => {
  const chunks = numberContexts('6-2와1,115와4.3.0와09:30와1~3').map((c) => c.chunk);
  assert.deepEqual(chunks, ['6-2', '1,115', '4.3.0', '09:30', '1~3']);
  assert.deepEqual(numberContexts('숫자가없다'), []);
  // 문맥은 앞뒤 2자씩, 문장 경계에서 자른다.
  assert.deepEqual(numberContexts('가나12다라마'), [{ chunk: '12', context: '가나12다라' }]);
  assert.deepEqual(numberContexts('12다'), [{ chunk: '12', context: '12다' }]);
});

test('긴 문장에서 숫자 한 글자만 달라도 미일치로 잡는다', () => {
  const r = judge(DATED.replace('2026-09-17', '2026-09-18'), { a: DATED_DOC });
  assert.equal(r.trimmed, 0);
  assert.equal(r.missing, 1);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0]!.code, 'E_FIDELITY');
  assert.equal(r.issues[0]!.level, 'error');
  assert.match(r.issues[0]!.message, /^숫자가 원본과 다르다\("2026-09-18", 일치 88%\): /);
});

test('문장 맨 앞 숫자 한 글자 변이도 잡는다', () => {
  const r = judge(`7${block(100, 19)}`, { a: HEADED_DOC });
  assert.equal(r.trimmed, 0);
  assert.equal(r.missing, 1);
  assert.match(r.issues[0]!.message, /^숫자가 원본과 다르다\("7", 일치 91%\): /);
});

test('숫자가 없는 다듬음은 경고 한 건으로 보여 준다', () => {
  const r = judge(LONG, { a: LONG.slice(0, 43) });
  assert.equal(r.trimmed, 1);
  assert.equal(r.missing, 0);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0]!.code, 'W_FIDELITY_TRIMMED');
  assert.equal(r.issues[0]!.level, 'warning');
  assert.equal(r.issues[0]!.where, 'pages[0].blocks[0].text');
  assert.equal(
    r.issues[0]!.message,
    `원본과 조금 다르다(일치 85%, 다른 곳 "${LONG.slice(43)}") — 눈으로 확인한다: ${LONG}`,
  );
});

test('맞은 창이 다 덮으면 "다른 곳"을 적지 않는다', () => {
  const r = judge(SPLIT, { a: SPLIT_DOC });
  assert.equal(r.trimmed, 1);
  assert.equal(r.exact, 0);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0]!.message, `원본과 조금 다르다(일치 100%) — 눈으로 확인한다: ${SPLIT}`);
});

test('숫자 문맥이 맞으면 다른 원본 판정은 그대로 산다', () => {
  const nearMiss = `${DATED.slice(0, 89)}${syl(200)}`; // 마지막 한 글자만 다르다
  const r = judge(DATED, { a: '아무 상관 없는 본문이다.', b: `# 원본\n\n${nearMiss}\n` }, 'a', ['a', 'b']);
  assert.equal(r.elsewhere, 1);
  assert.equal(r.missing, 0);
  assert.equal(r.trimmed, 0);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0]!.code, 'W_FIDELITY_ELSEWHERE');
  assert.equal(r.issues[0]!.message, `근거로 건 원본이 아닌 곳(b)에 있다: ${DATED.slice(0, 60)}`);
});

test('완전 일치는 숫자 문맥 가드를 타지 않는다', () => {
  const r = judge(DATED, { a: DATED_DOC });
  assert.equal(r.exact, 1);
  assert.equal(r.trimmed, 0);
  assert.equal(r.missing, 0);
  assert.deepEqual(r.issues, []);
});

test('다듬음 경고는 미일치 수와 종료 판단을 건드리지 않는다', () => {
  const r = judge(LONG, { a: LONG.slice(0, 43) });
  assert.equal(r.missing, 0); // cli는 missing만 보고 종료 코드를 정한다
  assert.equal(r.sentences, r.exact + r.trimmed + r.elsewhere + r.missing + r.skipped);
  assert.ok(r.issues.every((i) => i.level === 'warning'));
});

test('판정 다섯 갈래의 합은 센 문장 수와 같다', () => {
  const docs = new Map(Object.entries({ a: BODY, b: LONG.slice(0, 42) }));
  const doc = viewer(
    [
      { type: 'prose', id: 'B1', text: `${SENT}\n지어낸 문장이 여기 있다.`, evidence: [{ source: 'a' }] },
      { type: 'prose', id: 'B2', text: LONG, evidence: [{ source: 'b' }] },
      { type: 'prose', id: 'B3', text: SENT, evidence: [{ source: 'b' }] },
      { type: 'prose', id: 'B4', text: SENT, evidence: [{ source: 'c' }] },
    ],
    [],
    ['a', 'b', 'c'],
  );
  const r = checkFidelity({ viewer: doc, docs });
  assert.equal(r.strings, 4);
  assert.equal(r.sentences, r.exact + r.trimmed + r.elsewhere + r.missing + r.skipped);
  assert.equal(r.exact, 1);
  assert.equal(r.missing, 2);
  assert.equal(r.elsewhere, 1);
  assert.equal(r.skipped, 1);
});
