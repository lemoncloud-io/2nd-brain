import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Root } from 'mdast';

import { parseMarkdown, remarkChanged } from '../../shared/markdown.ts';

// 본문 3단락: 줄 1-2, 4-5, 7-8. bodyStartLine 5 → 파일 줄 5-6, 8-9, 11-12.
const BODY = 'a1\na2\n\nb1\nb2\n\nc1\nc2\n';

type Props = Record<string, unknown>;
function props(tree: Root): Array<Props | undefined> {
  return tree.children.map((n) => (n.data as { hProperties?: Props } | undefined)?.hProperties);
}

function run(options: Parameters<typeof remarkChanged>[0]): Array<Props | undefined> {
  const tree = parseMarkdown(BODY);
  remarkChanged(options)(tree);
  return props(tree);
}

test('hunk 와 겹치는 최상위 블록만 changed', () => {
  const p = run({ hunks: [{ start: 9, end: 9 }], removed: [], bodyStartLine: 5 });
  assert.equal(p.length, 3);
  assert.deepEqual(p[0]?.className ?? [], []);
  assert.deepEqual(p[1]?.className, ['changed']);
  assert.deepEqual(p[2]?.className ?? [], []);
});

test('removed 는 afterLine 뒤에 처음 시작하는 블록에 data-removed', () => {
  // afterLine 은 새 파일에서 지운 자리 바로 앞 줄(server/changes.ts). 파일 줄 6 = 첫 단락 끝 → 둘째 단락.
  const p = run({ hunks: [], removed: [{ afterLine: 6, count: 2 }], bodyStartLine: 5 });
  assert.equal(p[0]?.dataRemoved, undefined);
  assert.equal(p[1]?.dataRemoved, '2');
  assert.equal(p[2]?.dataRemoved, undefined);
  // 파일 줄 9 = 둘째 단락 끝 → 셋째 단락.
  const q = run({ hunks: [], removed: [{ afterLine: 9, count: 2 }], bodyStartLine: 5 });
  assert.equal(q[2]?.dataRemoved, '2');
  assert.equal(q[1]?.dataRemoved, undefined);
});

test('removed: 뒤에 블록이 없으면 마지막 블록, 같은 블록이면 합친다', () => {
  const p = run({
    hunks: [],
    removed: [
      { afterLine: 12, count: 1 },
      { afterLine: 20, count: 3 },
    ],
    bodyStartLine: 5,
  });
  assert.equal(p[2]?.dataRemoved, '4');
  const q = run({ hunks: [], removed: [{ afterLine: 0, count: 1 }], bodyStartLine: 5 });
  assert.equal(q[0]?.dataRemoved, '1');
});

test('frontmatter 안의 hunk 는 아무 블록도 표시하지 않는다', () => {
  const p = run({ hunks: [{ start: 1, end: 4 }], removed: [], bodyStartLine: 5 });
  assert.ok(p.every((x) => x?.className === undefined && x?.dataChanged === undefined));
});

test('여러 줄 hunk 는 걸친 블록 모두 changed', () => {
  const p = run({ hunks: [{ start: 6, end: 11 }], removed: [], bodyStartLine: 5 });
  assert.deepEqual(p.map((x) => x?.className), [['changed'], ['changed'], ['changed']]);
});

test('블록이 없으면 아무것도 하지 않는다', () => {
  const tree = parseMarkdown('');
  remarkChanged({ hunks: [{ start: 1, end: 1 }], removed: [{ afterLine: 0, count: 1 }], bodyStartLine: 1 })(tree);
  assert.equal(tree.children.length, 0);
});

test('agent 면 className 없이 data-changed=1', () => {
  const p = run({ hunks: [{ start: 9, end: 9 }], removed: [], bodyStartLine: 5, agent: true });
  assert.equal(p[1]?.className, undefined);
  assert.equal(p[1]?.dataChanged, '1');
  assert.equal(p[0]?.dataChanged, undefined);
});

test('코드 블록은 hProperties 를 건드리지 않고 data.hChanged·hRemoved 에 둔다', () => {
  // 줄 1: 단락, 줄 3-5: 코드 블록.
  const tree = parseMarkdown('intro\n\n```js\nx\n```\n');
  remarkChanged({ hunks: [{ start: 4, end: 4 }], removed: [{ afterLine: 2, count: 3 }], bodyStartLine: 1 })(tree);
  const code = tree.children[1]!;
  assert.equal(code.type, 'code');
  const data = code.data as { hProperties?: unknown; hChanged?: boolean; hRemoved?: number };
  assert.equal(data.hProperties, undefined);
  assert.equal(data.hChanged, true);
  assert.equal(data.hRemoved, 3);
});
