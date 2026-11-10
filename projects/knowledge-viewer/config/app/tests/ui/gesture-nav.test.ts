// 마우스 옆 단추·트랙패드 가로 스와이프·우클릭 끌기로 뒤로·앞으로. 순수 판정만 본다(DOM 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  mouseNavDirection,
  createSwipeTracker,
  classifyRightDrag,
  rightDragStarted,
  rightPressPassThrough,
  contextMenuVerdict,
  RIGHT_DRAG,
} = await import('../../src/app/gesture-nav.ts');

test('classifyRightDrag: |dx| 80px 이상이고 |dx| ≥ 2·|dy| — 왼쪽은 뒤로, 오른쪽은 앞으로', () => {
  assert.equal(RIGHT_DRAG.navPx, 80);
  assert.equal(classifyRightDrag(-80, 0), 'back');
  assert.equal(classifyRightDrag(80, 0), 'forward');
  assert.equal(classifyRightDrag(-79, 0), null);
  assert.equal(classifyRightDrag(79.9, 0), null);
  // 비스듬한 끌기: 정확히 2배면 되고, 그보다 세로가 크면 안 된다.
  assert.equal(classifyRightDrag(100, 50), 'forward');
  assert.equal(classifyRightDrag(-100, -50), 'back');
  assert.equal(classifyRightDrag(100, 51), null);
  assert.equal(classifyRightDrag(-120, 90), null);
  // 작은 움직임·세로 끌기.
  assert.equal(classifyRightDrag(0, 0), null);
  assert.equal(classifyRightDrag(5, -3), null);
  assert.equal(classifyRightDrag(0, 200), null);
});

test('rightDragStarted: 20px 부터 끌기다(표시·메뉴 막기)', () => {
  assert.equal(rightDragStarted(0, 0), false);
  assert.equal(rightDragStarted(19, 0), false);
  assert.equal(rightDragStarted(20, 0), true);
  assert.equal(rightDragStarted(-12, 16), true);
});

test('rightPressPassThrough: Alt/Option·고른 글 위·400ms 안의 두 번째 우클릭은 메뉴로 그냥 보낸다', () => {
  const base = { altKey: false, now: 10_000, lastStillUpAt: -Infinity, onSelection: false };
  assert.equal(rightPressPassThrough(base), false);
  assert.equal(rightPressPassThrough({ ...base, altKey: true }), true);
  assert.equal(rightPressPassThrough({ ...base, onSelection: true }), true);
  assert.equal(rightPressPassThrough({ ...base, lastStillUpAt: 10_000 - 400 }), true);
  assert.equal(rightPressPassThrough({ ...base, lastStillUpAt: 10_000 - 401 }), false);
});

test('contextMenuVerdict: 맥(누르는 중에 옴)은 막고, 윈도·리눅스(놓은 뒤 옴)는 끌었을 때만 막는다', () => {
  // 지켜보는 우클릭이 없다(메뉴 키·Ctrl+클릭·지도·입력 상자) → 네이티브.
  assert.equal(contextMenuVerdict(null), 'native');
  // 맥: mousedown 때 온다 — 끌지 알 수 없으니 막는다.
  assert.equal(contextMenuVerdict({ down: true, dragged: false, passThrough: false }), 'suppress');
  // 그냥 보내기로 한 우클릭(Alt·두 번째·고른 글)은 누르는 중이어도 네이티브.
  assert.equal(contextMenuVerdict({ down: true, dragged: false, passThrough: true }), 'native');
  // 윈도·리눅스: mouseup 뒤에 온다 — 움직임 없는 우클릭은 메뉴, 끈 것은 막는다.
  assert.equal(contextMenuVerdict({ down: false, dragged: false, passThrough: false }), 'native');
  assert.equal(contextMenuVerdict({ down: false, dragged: true, passThrough: false }), 'suppress');
});

test('mouseNavDirection: 옆 단추 3 은 뒤로, 4 는 앞으로, 그 밖은 없음', () => {
  assert.equal(mouseNavDirection(3), 'back');
  assert.equal(mouseNavDirection(4), 'forward');
  assert.equal(mouseNavDirection(0), null);
  assert.equal(mouseNavDirection(1), null);
  assert.equal(mouseNavDirection(2), null);
});

test('createSwipeTracker: 가로 delta 가 문턱을 넘으면 한 번만 — 음수(오른쪽 스와이프)는 뒤로, 양수는 앞으로', () => {
  const t = createSwipeTracker({ threshold: 100, idleMs: 300 });
  assert.equal(t.feed({ deltaX: -40, deltaY: 0, now: 0, blocked: false }), null);
  assert.equal(t.feed({ deltaX: -40, deltaY: 0, now: 20, blocked: false }), null);
  assert.equal(t.feed({ deltaX: -40, deltaY: 0, now: 40, blocked: false }), 'back');
  // 같은 제스처 안에서는 다시 쏘지 않는다.
  assert.equal(t.feed({ deltaX: -80, deltaY: 0, now: 60, blocked: false }), null);
  // 쉬고 나면 새 제스처.
  assert.equal(t.feed({ deltaX: 120, deltaY: 0, now: 500, blocked: false }), 'forward');
});

test('createSwipeTracker: 세로가 더 큰 휠·가로 스크롤이 남은 자리(blocked)·방향 바뀜은 쌓지 않는다', () => {
  const t = createSwipeTracker({ threshold: 100, idleMs: 300 });
  assert.equal(t.feed({ deltaX: -60, deltaY: -80, now: 0, blocked: false }), null);
  assert.equal(t.feed({ deltaX: -60, deltaY: 0, now: 10, blocked: false }), null);
  // 세로 휠은 쌓이지 않았으니 60 뿐 → 아직.
  assert.equal(t.feed({ deltaX: -30, deltaY: 0, now: 20, blocked: false }), null);
  // 가로로 스크롤할 수 있는 요소 위(blocked)는 쌓인 것을 비운다.
  assert.equal(t.feed({ deltaX: -30, deltaY: 0, now: 30, blocked: true }), null);
  assert.equal(t.feed({ deltaX: -90, deltaY: 0, now: 40, blocked: false }), null);
  // 방향이 바뀌면 처음부터.
  assert.equal(t.feed({ deltaX: 50, deltaY: 0, now: 50, blocked: false }), null);
  assert.equal(t.feed({ deltaX: 60, deltaY: 0, now: 60, blocked: false }), 'forward');
});
