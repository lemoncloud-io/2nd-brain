// 마우스 옆 단추·트랙패드 가로 스와이프·우클릭 끌기 → 뒤로·앞으로의 순수 판정. DOM 은 useGestureNav 가 만진다.
// 뷰어는 pushState 라우팅이라 브라우저 자체 제스처가 없는 창(앱 안 브라우저 패널)에서는 이 판정이 유일한 길이다.

export type NavDir = 'back' | 'forward';

/** 마우스 단추 번호 → 방향. 3(뒤로)·4(앞으로)는 X1·X2 옆 단추다. */
export function mouseNavDirection(button: number): NavDir | null {
  if (button === 3) return 'back';
  if (button === 4) return 'forward';
  return null;
}

export type SwipeSample = {
  deltaX: number;
  deltaY: number;
  /** ms. 쉬는 시간 판정에만 쓴다. */
  now: number;
  /** 그 자리의 요소가 그 방향으로 더 가로 스크롤할 수 있으면 true — 스와이프가 아니라 스크롤이다. */
  blocked: boolean;
};

export type SwipeTracker = { feed: (s: SwipeSample) => NavDir | null };

/**
 * 가로 휠(deltaX)을 한 제스처 동안 쌓아 문턱을 넘는 순간 한 번 쏜다. 음수(손가락 오른쪽으로)가 뒤로다 — 크롬과 같다.
 * 세로가 더 큰 샘플은 세로 스크롤이라 버리고, blocked 샘플과 방향 바뀜은 쌓인 것을 비운다. idleMs 이상 쉬면 새 제스처다.
 */
export function createSwipeTracker({ threshold = 120, idleMs = 300 }: { threshold?: number; idleMs?: number } = {}): SwipeTracker {
  let acc = 0;
  let last = -Infinity;
  let fired = false;
  return {
    feed({ deltaX, deltaY, now, blocked }) {
      if (now - last > idleMs) {
        acc = 0;
        fired = false;
      }
      last = now;
      if (Math.abs(deltaX) <= Math.abs(deltaY)) return null;
      if (blocked || (acc !== 0 && Math.sign(deltaX) !== Math.sign(acc))) {
        acc = 0;
        fired = false;
        if (blocked) return null;
      }
      acc += deltaX;
      if (fired || Math.abs(acc) < threshold) return null;
      fired = true;
      return acc < 0 ? 'back' : 'forward';
    },
  };
}

// ── 오른쪽 단추 끌기 제스처(2026-10-27 오너 요청) ──
// 오른쪽 단추를 누른 채 왼쪽으로 끌었다 놓으면 뒤로, 오른쪽이면 앞으로.

/** 우클릭 끌기 문턱(px·ms). nav: 이만큼 가로로 가야 간다. hint: 이만큼 움직이면 끌기로 보고 표시를 띄운다. double: 두 번 우클릭 간격. */
export const RIGHT_DRAG = { navPx: 80, ratio: 2, hintPx: 20, doubleMs: 400 } as const;

/** 놓은 자리까지의 이동(dx, dy) → 방향. |dx| ≥ 80 이고 |dx| ≥ 2·|dy| 여야 한다. 음수(왼쪽)가 뒤로다. */
export function classifyRightDrag(dx: number, dy: number): NavDir | null {
  const ax = Math.abs(dx);
  if (ax < RIGHT_DRAG.navPx || ax < RIGHT_DRAG.ratio * Math.abs(dy)) return null;
  return dx < 0 ? 'back' : 'forward';
}

/** 끌기로 볼 만큼 움직였는가(표시를 띄우고, 놓은 뒤의 메뉴를 막는다). */
export function rightDragStarted(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= RIGHT_DRAG.hintPx;
}

/**
 * 이 우클릭을 제스처로 보지 않고 네이티브 메뉴로 그냥 보내는가. 맥 크로미움은 `contextmenu` 를 누르는 순간(움직이기 전)에 쏘므로
 * 제스처를 쓰려면 누를 때 메뉴를 막아야 한다 — 그 대신 메뉴가 필요할 때 쓸 길을 남긴다:
 * (a) Alt/Option + 우클릭, (b) 메뉴를 막은 움직임 없는 우클릭을 놓고 400ms 안에 다시 우클릭, (c) 고른 글 위에서 우클릭(복사 등).
 */
export function rightPressPassThrough(s: { altKey: boolean; now: number; lastStillUpAt: number; onSelection: boolean }): boolean {
  return s.altKey || s.onSelection || s.now - s.lastStillUpAt <= RIGHT_DRAG.doubleMs;
}

/** 지켜보는 우클릭 하나. down: 아직 누르고 있다. dragged: 문턱(20px)을 넘었다. passThrough: 메뉴로 그냥 보낸다. */
export type RightPress = { down: boolean; dragged: boolean; passThrough: boolean };

/**
 * `contextmenu` 를 막을지. 지켜보는 우클릭이 없으면(키보드 메뉴 키·Ctrl+클릭·제외 영역) 네이티브다.
 * 누르는 중에 왔으면(맥: mousedown 때 쏜다) 끌지 알 수 없으니 막는다. 놓은 뒤 왔으면(윈도·리눅스: mouseup 뒤에 쏜다) 끌었을 때만 막는다.
 */
export function contextMenuVerdict(press: RightPress | null): 'native' | 'suppress' {
  if (press === null || press.passThrough) return 'native';
  if (press.down) return 'suppress';
  return press.dragged ? 'suppress' : 'native';
}
