// PR 상세의 바뀐 파일을 폴더 트리로 묶는 순수 함수. 한 갈래 폴더는 한 줄로 접고, 폴더가 파일보다 앞, 이름순.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ChangedFile } from '../../src/app/types.ts';

const { buildFileTree } = await import('../../src/panels/pr-files-tree.ts');

const files: ChangedFile[] = [
  { path: 'projects/x/outputs/b.md', status: 'A' },
  { path: 'projects/x/README.md', status: 'A' },
  { path: 'projects/x/outputs/a.md', status: 'A' },
  { path: 'wiki/gone.md', status: 'D' },
  { path: 'projects/@org/core/README.md', status: 'M' },
  { path: 'wiki/new-name.md', status: 'R', from: 'wiki/old-name.md' },
  { path: 'README.md', status: 'M' },
];

test('buildFileTree: 폴더 먼저·이름순, 파일 잎은 원본 ChangedFile 을 그대로 든다', () => {
  const tree = buildFileTree(files);
  assert.deepEqual(
    tree.map((n) => (n.kind === 'dir' ? `dir:${n.name}` : `file:${n.name}`)),
    ['dir:projects', 'dir:wiki', 'file:README.md'],
  );
  const wiki = tree[1]!;
  assert.equal(wiki.kind, 'dir');
  if (wiki.kind !== 'dir') return;
  assert.deepEqual(
    wiki.children.map((n) => (n.kind === 'file' ? `${n.name}:${n.file.status}` : n.name)),
    ['gone.md:D', 'new-name.md:R'],
  );
});

test('buildFileTree: 자식이 폴더 하나뿐인 폴더는 경로를 한 줄로 접는다', () => {
  const tree = buildFileTree(files);
  const projects = tree[0]!;
  assert.equal(projects.kind, 'dir');
  if (projects.kind !== 'dir') return;
  // projects/@org/core 는 한 갈래라 접히고, projects/x 는 파일과 폴더를 함께 가져 접히지 않는다.
  assert.deepEqual(
    projects.children.map((n) => (n.kind === 'dir' ? `dir:${n.name}` : `file:${n.name}`)),
    ['dir:@org/core', 'dir:x'],
  );
  const x = projects.children[1]!;
  if (x.kind !== 'dir') return;
  assert.equal(x.path, 'projects/x');
  assert.deepEqual(
    x.children.map((n) => (n.kind === 'dir' ? `dir:${n.name}` : `file:${n.name}`)),
    ['dir:outputs', 'file:README.md'],
  );
});

test('buildFileTree: 루트 파일만 있으면 폴더 없이 잎만, 빈 목록은 빈 배열', () => {
  assert.deepEqual(buildFileTree([]), []);
  const only = buildFileTree([{ path: 'a.md', status: 'M' }]);
  assert.equal(only.length, 1);
  assert.equal(only[0]!.kind, 'file');
});
