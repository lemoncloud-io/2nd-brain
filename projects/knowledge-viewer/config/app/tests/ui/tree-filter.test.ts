// 트리 필터: 맞는 문서와 그 상위 폴더만 남긴 가상 트리.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { filterTree } from '../../src/app/tree-filter.ts';

const items = [
  { path: 'wiki/INDEX.md', title: 'INDEX' },
  { path: 'wiki/knowledge.md', title: '지식 관리' },
  { path: 'projects/a/README.md', title: 'A 프로젝트' },
  { path: 'projects/a/docs/jisik.md', title: '지식 메모' },
  { path: 'projects/b/README.md', title: 'B' },
];

test('맞는 문서와 상위 폴더만, 폴더 먼저·이름순', () => {
  const r = filterTree('지식', items, 100);
  assert.equal(r.total, 2);
  assert.equal(r.shown, 2);
  assert.deepEqual(r.root.dirs.map((d) => d.path), ['projects', 'wiki']);
  assert.deepEqual(r.root.files, []);
  const projects = r.root.dirs[0]!;
  assert.deepEqual(projects.dirs.map((d) => d.path), ['projects/a']);
  assert.deepEqual(projects.dirs[0]!.dirs.map((d) => d.path), ['projects/a/docs']);
  assert.deepEqual(projects.dirs[0]!.dirs[0]!.files.map((f) => f.path), ['projects/a/docs/jisik.md']);
  assert.deepEqual(projects.dirs[0]!.dirs[0]!.files[0]!.ranges, [[0, 2]]);
  assert.deepEqual(r.root.dirs[1]!.files.map((f) => f.path), ['wiki/knowledge.md']);
});

test('초성·경로 일치도 들어간다', () => {
  const r = filterTree('ㅈㅅ', items, 100);
  assert.deepEqual(r.root.dirs.flatMap((d) => [...d.files, ...d.dirs.flatMap((x) => [...x.files, ...x.dirs.flatMap((y) => y.files)])]).map((f) => f.path).sort(), [
    'projects/a/docs/jisik.md',
    'wiki/knowledge.md',
  ]);
  const p = filterTree('jisik', items, 100);
  assert.equal(p.total, 1);
  // 경로만 맞으면 제목 범위는 비어 있다.
  assert.deepEqual(p.root.dirs[0]!.dirs[0]!.dirs[0]!.files[0]!.ranges, []);
});

test('한도를 넘으면 점수 순으로 자르고 total 은 전체다', () => {
  const r = filterTree('README', items, 1);
  assert.equal(r.total, 2);
  assert.equal(r.shown, 1);
});

test('빈 질의는 아무것도 없다', () => {
  const r = filterTree('  ', items, 100);
  assert.equal(r.total, 0);
  assert.deepEqual(r.root.dirs, []);
});
