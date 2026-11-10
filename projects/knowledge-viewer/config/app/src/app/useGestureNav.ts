// 마우스 옆 단추(X1·X2)와 트랙패드 가로 스와이프를 history.back/forward 에 잇는다(오너 요청 2026-10-27).
// 판정은 gesture-nav.ts(순수). 브라우저가 옆 단추를 스스로 처리하는 창에서 두 번 가지 않게 mouseup 의 기본 동작을 막는다.
// 우클릭 끌기(같은 날 오너 요청)도 여기서 잇는다 — 왼쪽으로 끌었다 놓으면 뒤로, 오른쪽이면 앞으로. 메뉴 규칙은 contextMenuVerdict.
import { useEffect } from 'react';

import {
  classifyRightDrag,
  contextMenuVerdict,
  createSwipeTracker,
  mouseNavDirection,
  rightDragStarted,
  rightPressPassThrough,
  type NavDir,
  type RightPress,
} from './gesture-nav.ts';

const go = (dir: NavDir) => (dir === 'back' ? history.back() : history.forward());

/** 휠이 떨어진 자리에서 위로 올라가며, 그 방향으로 더 가로 스크롤할 수 있는 요소가 있으면 true. */
export function canScrollSideways(start: EventTarget | null, deltaX: number): boolean {
  let el = start instanceof Element ? start : null;
  while (el !== null && el !== document.body) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const o = getComputedStyle(el).overflowX;
      if (o === 'auto' || o === 'scroll') {
        const room = deltaX < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
        if (room) return true;
      }
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * 우클릭 끌기를 보지 않는 자리: 입력 상자(붙여넣기 메뉴)·지도(3D 는 우클릭 끌기가 이동이다)·캔버스·iframe.
 * 여기서 누른 우클릭은 지켜보지 않으니 메뉴도 막지 않는다.
 */
const RIGHT_DRAG_EXCLUDE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .graph-wrap, canvas, iframe';

function rightDragExcluded(t: EventTarget | null): boolean {
  return t instanceof Element && t.closest(RIGHT_DRAG_EXCLUDE) !== null;
}

/** 누른 자리가 고른 글(선택 영역) 위인가. */
function overSelection(x: number, y: number): boolean {
  const sel = window.getSelection();
  if (sel === null || sel.isCollapsed || sel.rangeCount === 0) return false;
  for (let i = 0; i < sel.rangeCount; i++) {
    for (const r of sel.getRangeAt(i).getClientRects()) {
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
  }
  return false;
}

/** 끌기 표시(`← 뒤로`·`앞으로 →`). 처음 쓸 때 body 에 하나 만들고 숨겼다 보였다 한다. 누르기·고르기를 막지 않는다(pointer-events: none). */
function gestureHint() {
  let el: HTMLDivElement | null = null;
  return {
    show(x: number, y: number, dx: number, armed: boolean) {
      if (el === null) {
        el = document.createElement('div');
        el.className = 'gesture-hint';
        el.setAttribute('aria-hidden', 'true');
        document.body.append(el);
      }
      el.textContent = dx < 0 ? '← 뒤로' : '앞으로 →';
      el.dataset.armed = armed ? '1' : '0';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.hidden = false;
    },
    hide() {
      if (el !== null) el.hidden = true;
    },
    remove() {
      el?.remove();
      el = null;
    },
  };
}

export function useGestureNav(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const tracker = createSwipeTracker();
    const onMouseUp = (e: MouseEvent) => {
      const dir = mouseNavDirection(e.button);
      if (dir === null) return;
      e.preventDefault();
      go(dir);
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return; // 핀치·확대
      const dir = tracker.feed({ deltaX: e.deltaX, deltaY: e.deltaY, now: e.timeStamp, blocked: canScrollSideways(e.target, e.deltaX) });
      if (dir !== null) go(dir);
    };

    // ── 우클릭 끌기 ──
    const hint = gestureHint();
    /** 지켜보는 우클릭. 놓은 뒤에도 잠깐 남긴다 — 윈도·리눅스는 contextmenu 가 mouseup 뒤에 온다. */
    let press: (RightPress & { x0: number; y0: number; upAt: number; suppressed: boolean }) | null = null;
    /** 메뉴를 막은, 움직임 없는 우클릭을 놓은 때. 400ms 안의 다음 우클릭은 메뉴로 보낸다. */
    let lastStillUpAt = -Infinity;
    const cancel = () => {
      press = null;
      hint.hide();
    };
    const onRightDown = (e: MouseEvent) => {
      if (e.button !== 2) return;
      if (rightDragExcluded(e.target)) {
        press = null;
        return;
      }
      const passThrough = rightPressPassThrough({ altKey: e.altKey, now: e.timeStamp, lastStillUpAt, onSelection: overSelection(e.clientX, e.clientY) });
      if (passThrough) lastStillUpAt = -Infinity; // 한 번 쓰면 끝 — 세 번째 우클릭은 다시 제스처다.
      press = { x0: e.clientX, y0: e.clientY, down: true, dragged: false, passThrough, upAt: 0, suppressed: false };
    };
    const onRightMove = (e: MouseEvent) => {
      if (press === null || !press.down || press.passThrough) return;
      // 창 밖에서 놓아 mouseup 을 못 받았다.
      if ((e.buttons & 2) === 0) return cancel();
      const dx = e.clientX - press.x0;
      const dy = e.clientY - press.y0;
      if (!press.dragged && rightDragStarted(dx, dy)) press.dragged = true;
      if (press.dragged) hint.show(e.clientX, e.clientY, dx, classifyRightDrag(dx, dy) !== null);
    };
    const onRightUp = (e: MouseEvent) => {
      if (e.button !== 2 || press === null || !press.down) return;
      press.down = false;
      press.upAt = e.timeStamp;
      hint.hide();
      if (press.passThrough) return;
      if (!press.dragged && press.suppressed) lastStillUpAt = e.timeStamp;
      const dir = press.dragged ? classifyRightDrag(e.clientX - press.x0, e.clientY - press.y0) : null;
      if (dir !== null) go(dir);
    };
    const onContextMenu = (e: MouseEvent) => {
      // 놓은 지 오래된 것은 이 메뉴와 상관없다(키보드 메뉴 키 등).
      const live = press !== null && (press.down || e.timeStamp - press.upAt < 500) ? press : null;
      if (contextMenuVerdict(live) === 'suppress') {
        e.preventDefault();
        if (live !== null) live.suppressed = true;
      }
      if (live !== null && !live.down) press = null;
    };

    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('mousedown', onRightDown, true);
    window.addEventListener('mousemove', onRightMove, true);
    window.addEventListener('mouseup', onRightUp, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('mousedown', onRightDown, true);
      window.removeEventListener('mousemove', onRightMove, true);
      window.removeEventListener('mouseup', onRightUp, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('blur', cancel);
      hint.remove();
    };
  }, [enabled]);
}
