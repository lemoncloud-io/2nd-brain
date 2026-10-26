// 2D 노드 그리기: 펼칠 수 있는 노드에만 `+` 배지를 쓴다. 허브의 빈 고리는 그대로다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { GraphNode } from '../../src/app/types.ts';
import { drawNode } from '../../src/graph/canvasObject.ts';

/** 부른 그리기 명령만 적는 가짜 캔버스. */
function fakeCtx(): { ctx: CanvasRenderingContext2D; texts: string[]; strokes: number } {
  const rec = { texts: [] as string[], strokes: 0 };
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    arc() {},
    fill() {},
    stroke() {
      rec.strokes += 1;
    },
    fillText(t: string) {
      rec.texts.push(t);
    },
  } as unknown as CanvasRenderingContext2D;
  return {
    ctx,
    get texts() {
      return rec.texts;
    },
    get strokes() {
      return rec.strokes;
    },
  };
}

const node = (over: Partial<GraphNode> = {}): GraphNode & { x: number; y: number } => ({
  path: 'wiki/a.md',
  title: '에이',
  kind: 'concept',
  cluster: 'wiki',
  hop: 1,
  in: 3,
  out: 2,
  hub: false,
  truncated: false,
  x: 0,
  y: 0,
  ...over,
});

const opts = { color: '#888888', isCenter: false, hovered: false, plus: false, label: false };

test('drawNode: plus 면 `+` 를 쓰고, 아니면 쓰지 않는다', () => {
  const on = fakeCtx();
  drawNode(node({ truncated: true }), on.ctx, 1, { ...opts, plus: true });
  assert.deepEqual(on.texts, ['+']);
  const off = fakeCtx();
  drawNode(node({ truncated: true }), off.ctx, 1, { ...opts, plus: false });
  assert.deepEqual(off.texts, []);
});

test('drawNode: 허브는 빈 고리와 `+`, 주요 노드(label)면 제목을 함께 그린다', () => {
  const f = fakeCtx();
  drawNode(node({ hub: true, truncated: true }), f.ctx, 2, { ...opts, plus: true, label: true });
  assert.equal(f.strokes, 1);
  assert.deepEqual(f.texts, ['+', '에이']);
});

test('drawNode: 주요 노드가 아니면 제목은 hover 때만 그린다', () => {
  const quiet = fakeCtx();
  drawNode(node(), quiet.ctx, 1, opts);
  assert.deepEqual(quiet.texts, []);
  const hov = fakeCtx();
  drawNode(node(), hov.ctx, 1, { ...opts, hovered: true });
  assert.deepEqual(hov.texts, ['에이']);
});
