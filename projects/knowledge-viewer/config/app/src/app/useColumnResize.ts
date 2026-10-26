// 왼쪽·오른쪽 열 폭 드래그. 손잡이를 누른 채 움직이면 폭이 따라가고, 놓으면 저장한다. 더블클릭은 기본 폭으로.
import { useCallback, useRef, useState } from 'react';
import type React from 'react';

import {
  clampLeftWidth,
  clampRightWidth,
  LEFT_DEFAULT,
  readLeftWidth,
  readRightWidth,
  RIGHT_DEFAULT,
  writeLeftWidth,
  writeRightWidth,
} from './prefs/layout.ts';

export type ColumnSide = 'left' | 'right';

const SIDES = {
  left: { read: readLeftWidth, write: writeLeftWidth, clamp: clampLeftWidth, def: LEFT_DEFAULT },
  right: { read: readRightWidth, write: writeRightWidth, clamp: clampRightWidth, def: RIGHT_DEFAULT },
} as const;

/**
 * 드래그 중 폭. 왼쪽 열은 손잡이가 오른쪽 가장자리라 오른쪽으로 끌면 넓어지고,
 * 오른쪽 열은 손잡이가 왼쪽 가장자리라 왼쪽으로 끌면 넓어진다. 순수 함수.
 */
export function dragWidth(side: ColumnSide, startW: number, dx: number): number {
  return SIDES[side].clamp(startW + (side === 'left' ? dx : -dx));
}

export function useColumnResize(side: ColumnSide): {
  width: number;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
} {
  const s = SIDES[side];
  const [width, setWidth] = useState<number>(s.read);
  const widthRef = useRef(width);
  widthRef.current = width;
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = widthRef.current;
      const move = (ev: PointerEvent) => {
        const w = dragWidth(side, startW, ev.clientX - startX);
        widthRef.current = w;
        setWidth(w);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        SIDES[side].write(widthRef.current);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [side],
  );
  const onDoubleClick = useCallback(() => {
    const w = SIDES[side].def;
    widthRef.current = w;
    setWidth(w);
    SIDES[side].write(w);
  }, [side]);
  return { width, onPointerDown, onDoubleClick };
}
