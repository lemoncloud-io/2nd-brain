// 리더가 바뀐 블록에 다는 표식의 셀렉터. 본문 위 요약(Reader)과 PR 상세 패널의 이동 단추가 같은 것을 센다.
// 화면 모드는 class "changed", 에이전트 모드는 data-changed, 지우기만 한 자리는 data-removed 다.

/** 바뀐 블록(본문 안에서 고른다). */
export const CHANGED_SELECTOR = '.changed, [data-changed], [data-removed]';

/** 문서 본문(.doc) 안의 바뀐 블록. document 전체에서 고를 때 쓴다. */
export const CHANGED_IN_DOC = CHANGED_SELECTOR.split(', ')
  .map((s) => `.doc ${s}`)
  .join(', ');
