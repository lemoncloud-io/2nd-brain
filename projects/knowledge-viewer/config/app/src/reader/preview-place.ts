// 호버 카드의 자리 계산. 순수 모듈이다(DOM을 만지지 않는다).
export type Rect = { left: number; top: number; right: number; bottom: number };
export type Size = { width: number; height: number };
export type Placement = { left: number; top: number; side: 'below' | 'above' };

export const CARD_MAX_WIDTH = 400;
export const CARD_MAX_HEIGHT = 350;
const MARGIN = 12;
const GAP = 8;

/** 앵커 아래에 놓는다. 아래에 자리가 모자라고 위가 넉넉하면 위에 놓는다. 가장자리에서 MARGIN 이상 떨어뜨린다. */
export function placeCard(anchor: Rect, viewport: Size, card: Size): Placement {
  const maxLeft = Math.max(MARGIN, viewport.width - card.width - MARGIN);
  const left = Math.min(Math.max(anchor.left, MARGIN), maxLeft);
  const belowTop = anchor.bottom + GAP;
  const aboveTop = anchor.top - GAP - card.height;
  const roomBelow = viewport.height - MARGIN - belowTop;
  const fitsBelow = card.height <= roomBelow;
  const fitsAbove = aboveTop >= MARGIN;
  const above = !fitsBelow && (fitsAbove || anchor.top - GAP - MARGIN > roomBelow);
  const maxTop = Math.max(MARGIN, viewport.height - card.height - MARGIN);
  const top = Math.min(Math.max(above ? aboveTop : belowTop, MARGIN), maxTop);
  return { left, top, side: above ? 'above' : 'below' };
}
