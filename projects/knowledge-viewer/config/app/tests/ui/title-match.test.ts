// 제목·경로 즉시 검색. 접두 > 단어 시작 > 포함 > 초성 순서와 하이라이트 범위.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchTitle, prepareTitle, rankPrepared, rankTitles, SCORE } from '../../src/app/title-match.ts';

test('접두 일치: 점수 100, 범위는 앞', () => {
  assert.deepEqual(matchTitle('지식', '지식 관리'), { score: SCORE.prefix, ranges: [[0, 2]] });
  assert.deepEqual(matchTitle('index', 'INDEX'), { score: SCORE.prefix, ranges: [[0, 5]] });
});

test('단어 시작·포함', () => {
  assert.deepEqual(matchTitle('mem', 'agent memory'), { score: SCORE.word, ranges: [[6, 9]] });
  assert.deepEqual(matchTitle('ent', 'agent memory'), { score: SCORE.contains, ranges: [[2, 5]] });
  // 한글 띄어쓰기·구분자 뒤도 단어 시작이다.
  assert.deepEqual(matchTitle('관리', '지식 관리'), { score: SCORE.word, ranges: [[3, 5]] });
  assert.deepEqual(matchTitle('viewer', 'knowledge-viewer'), { score: SCORE.word, ranges: [[10, 16]] });
});

test('초성: ㅈㅅ 는 지식·장식을 맞추고 문서는 아니다', () => {
  assert.deepEqual(matchTitle('ㅈㅅ', '지식'), { score: SCORE.prefix - SCORE.initialPenalty, ranges: [[0, 2]] });
  assert.equal(matchTitle('ㅈㅅ', '장식')?.score, SCORE.prefix - SCORE.initialPenalty);
  assert.equal(matchTitle('ㅈㅅ', '문서'), null);
  // 음절·자음 섞인 질의도 된다.
  assert.equal(matchTitle('지ㅅ', '지식')?.score, SCORE.prefix - SCORE.initialPenalty);
  // 평자음은 된소리 초성에 맞는다.
  assert.deepEqual(matchTitle('ㄱㄷ', '깍두기')?.ranges, [[0, 2]]);
  // 초성 포함 일치.
  assert.deepEqual(matchTitle('ㄱㄹ', '지식 관리'), { score: SCORE.word - SCORE.initialPenalty, ranges: [[3, 5]] });
});

test('여러 단어는 AND, 점수는 합, 범위는 합쳐서 정렬', () => {
  assert.deepEqual(matchTitle('agent mem', 'agent memory'), { score: SCORE.prefix + SCORE.word, ranges: [[0, 5], [6, 9]] });
  assert.equal(matchTitle('agent zzz', 'agent memory'), null);
  // 겹치는 범위는 하나로 합친다.
  assert.deepEqual(matchTitle('aa a', 'aaa'), { score: SCORE.prefix * 2, ranges: [[0, 2]] });
});

test('빈 질의·빈 제목은 null', () => {
  assert.equal(matchTitle('', 'x'), null);
  assert.equal(matchTitle('   ', 'x'), null);
  assert.equal(matchTitle('x', ''), null);
});

test('같은 자리의 여러 후보 중 가장 높은 등급을 고른다', () => {
  // '지식' 이 뒤에 정확히 있으면 앞의 초성 일치(ㅈㅅ→장식)보다 정확 일치가 아니다 — 질의가 자음이면 초성 등급이다.
  assert.equal(matchTitle('ㅈㅅ', '장식 지식')?.score, SCORE.prefix - SCORE.initialPenalty);
  // 포함(앞)보다 단어 시작(뒤)을 고른다.
  assert.deepEqual(matchTitle('em', 'sem em'), { score: SCORE.word, ranges: [[4, 6]] });
});

const items = [
  { path: 'wiki/INDEX.md', title: 'INDEX' },
  { path: 'wiki/knowledge.md', title: '지식 관리' },
  { path: 'wiki/deco.md', title: '장식' },
  { path: 'wiki/agent-memory.md', title: 'Agent Memory' },
  { path: 'wiki/memo.md', title: 'memo index' },
  { path: 'projects/jisik/README.md', title: '프로젝트' },
];

test('rankTitles: 제목 일치가 경로 일치보다 앞이고, 점수·제목 길이·경로 순이다', () => {
  const r = rankTitles('ㅈㅅ', items, 10);
  assert.deepEqual(
    r.map((h) => h.path),
    ['wiki/deco.md', 'wiki/knowledge.md'],
  );
  assert.deepEqual(r[0]?.titleRanges, [[0, 2]]);
  const idx = rankTitles('index', items, 10);
  assert.equal(idx[0]?.path, 'wiki/INDEX.md');
  assert.equal(idx[1]?.path, 'wiki/memo.md');
  // 제목에 없고 경로에만 있으면 경로 범위로 나온다.
  const p = rankTitles('jisik', items, 10);
  assert.equal(p[0]?.path, 'projects/jisik/README.md');
  assert.deepEqual(p[0]?.titleRanges, []);
  assert.deepEqual(p[0]?.pathRanges, [[9, 14]]);
});

test('rankTitles: limit 과 total', () => {
  const r = rankTitles('m', items, 1);
  assert.equal(r.length, 1);
});

test('rankTitles: 2,300 건을 한 번 훑는 데 수 ms 다', () => {
  const big: { path: string; title: string }[] = [];
  const words = ['지식', '관리', 'agent', 'memory', '장식', '문서', 'index', '설계', 'viewer', '검색'];
  for (let i = 0; i < 2300; i++) {
    const w = words[i % words.length]!;
    const v = words[(i * 7) % words.length]!;
    big.push({ path: `projects/p${i % 40}/${w}-${i}.md`, title: `${w} ${v} ${i}` });
  }
  const prepared = big.map(prepareTitle);
  const n = 50;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) rankPrepared(i % 2 ? 'ㅈㅅ' : 'agent mem', prepared, 20);
  const per = (performance.now() - t0) / n;
  const t1 = performance.now();
  for (let i = 0; i < n; i++) rankTitles(i % 2 ? 'ㅈㅅ' : 'agent mem', big, 20);
  const perRaw = (performance.now() - t1) / n;
  console.log(`rankPrepared 2,300 건 ${per.toFixed(2)} ms/회 (준비 없이 ${perRaw.toFixed(2)} ms/회)`);
  assert.ok(per < 20, `too slow: ${per} ms`);
});
