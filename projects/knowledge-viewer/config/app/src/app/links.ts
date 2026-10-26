// 앵커 클릭을 앱 안 이동으로 가로챌지 정한다. 순수 함수다.
export type ClickLike = { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number };

/** 수정키 없이 왼쪽 단추로 누른 경우만 true다. 아니면 브라우저가 새 탭·새 창 등으로 처리한다. */
export function isPlainClick(e: ClickLike): boolean {
  return !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0;
}
