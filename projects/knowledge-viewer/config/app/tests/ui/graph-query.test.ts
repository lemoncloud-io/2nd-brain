// 지도 조회 주소(/api/graph?...)의 쿼리 문자열. expand 는 쉼표로 이은 값 하나다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { graphQueryString } from '../../src/app/api.ts';

test('graphQueryString: 전체 보기는 all=1 하나', () => {
  assert.equal(graphQueryString({ all: true }), 'all=1');
});

test('graphQueryString: 한글·공백 중심은 부호화하고, 빈 expand 는 붙이지 않는다', () => {
  const s = graphQueryString({ center: 'wiki/한글 노트.md', depth: 2, hubs: 'keep', expand: [] });
  const p = new URLSearchParams(s);
  assert.equal(p.get('center'), 'wiki/한글 노트.md');
  assert.equal(p.get('depth'), '2');
  assert.equal(p.get('hubs'), 'keep');
  assert.equal(p.has('expand'), false);
  assert.ok(!s.includes('한글'), s);
  assert.ok(!s.includes(' '), s);
});

test('graphQueryString: expand 는 쉼표로 이은 값 하나, 부호화한다', () => {
  const s = graphQueryString({ center: 'wiki/x.md', depth: 1, hubs: 'expand', expand: ['a.md', 'b c.md'] });
  const p = new URLSearchParams(s);
  assert.deepEqual(p.getAll('expand'), ['a.md,b c.md']);
  assert.ok(s.includes('expand=a.md%2Cb+c.md'), s);
});
