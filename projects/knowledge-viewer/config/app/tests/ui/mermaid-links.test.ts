// Mermaid 노드 클릭 링크: click 줄 파싱(두 문법·툴팁·콜백 무시)과 주소 해석(문서 기준 상대·앵커·상위·외부).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mermaidLinkTarget, nodeIdFromGroupId, parseMermaidClicks } from '../../src/reader/mermaid-links.ts';

test('parseMermaidClicks: 두 문법·툴팁 유무·여러 id, 콜백은 무시한다', () => {
  const code = [
    'flowchart LR',
    '  RUN --> TGT',
    '  click RUN "config/skills/post-run.md" "툴팁"',
    '  click TGT href "sub/target.md#둘째"',
    '  click EXT "https://example.com" "외부" _blank',
    '  click A,B "a.md"',
    '  click CB call alert(1)',
    '  click CB2 callbackFn "콜백 툴팁"',
  ].join('\n');
  const m = parseMermaidClicks(code);
  assert.deepEqual(m.get('RUN'), { href: 'config/skills/post-run.md', tooltip: '툴팁' });
  assert.deepEqual(m.get('TGT'), { href: 'sub/target.md#둘째' });
  assert.deepEqual(m.get('EXT'), { href: 'https://example.com', tooltip: '외부' });
  assert.deepEqual(m.get('A'), { href: 'a.md' });
  assert.deepEqual(m.get('B'), { href: 'a.md' });
  assert.equal(m.has('CB'), false);
  assert.equal(m.has('CB2'), false);
  assert.equal(m.size, 5);
});

test('nodeIdFromGroupId: flowchart 노드 그룹 id 에서 노드 id', () => {
  assert.equal(nodeIdFromGroupId('mmd-1-flowchart-RUN-0'), 'RUN');
  assert.equal(nodeIdFromGroupId('mmd-12-flowchart-node-a-13'), 'node-a');
  assert.equal(nodeIdFromGroupId('classId-Foo-1'), null);
});

test('mermaidLinkTarget: 문서 기준 상대 경로·앵커·상위 경로', () => {
  const doc = 'projects/demo/README.md';
  assert.deepEqual(mermaidLinkTarget(doc, 'config/skills/post-run.md'), { kind: 'doc', path: 'projects/demo/config/skills/post-run.md', anchor: '' });
  assert.deepEqual(mermaidLinkTarget(doc, 'config/skills/post-run.md#실행-순서'), { kind: 'doc', path: 'projects/demo/config/skills/post-run.md', anchor: '실행-순서' });
  // mermaid 가 부호화해 내도 풀어서 읽는다.
  assert.deepEqual(mermaidLinkTarget(doc, 'a.md#%EB%91%98%EC%A7%B8'), { kind: 'doc', path: 'projects/demo/a.md', anchor: '둘째' });
  assert.deepEqual(mermaidLinkTarget(doc, '../../wiki/INDEX.md'), { kind: 'doc', path: 'wiki/INDEX.md', anchor: '' });
  assert.deepEqual(mermaidLinkTarget(doc, 'outputs/'), { kind: 'doc', path: 'projects/demo/outputs', anchor: '' });
  assert.deepEqual(mermaidLinkTarget(doc, 'viewer/index.html'), { kind: 'doc', path: 'projects/demo/viewer/index.html', anchor: '' });
  assert.deepEqual(mermaidLinkTarget(doc, 'img/flow.png'), { kind: 'file', path: 'projects/demo/img/flow.png', anchor: '' });
});

test('mermaidLinkTarget: 외부·앵커·볼트 밖·빈 값', () => {
  const doc = 'a/b.md';
  assert.deepEqual(mermaidLinkTarget(doc, 'https://example.com/x'), { kind: 'external', url: 'https://example.com/x' });
  assert.deepEqual(mermaidLinkTarget(doc, '#절'), { kind: 'anchor', anchor: '절' });
  assert.deepEqual(mermaidLinkTarget(doc, '../../../out.md'), { kind: 'none' });
  assert.deepEqual(mermaidLinkTarget(doc, '/abs.md'), { kind: 'none' });
  assert.deepEqual(mermaidLinkTarget(doc, 'about:blank'), { kind: 'none' });
  assert.deepEqual(mermaidLinkTarget(doc, ''), { kind: 'none' });
  assert.deepEqual(mermaidLinkTarget(doc, null), { kind: 'none' });
});
