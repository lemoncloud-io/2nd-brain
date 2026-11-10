// 가운데 열 확장 화면(?view=<id>) 헬퍼. 순수 모듈이다.
import type { CenterViewExtension } from '../ext/define.ts';

/** 등록된 확장 보기 중 id 가 같은 것. 코어 보기(doc·graph)·모르는 id 는 null. */
export function findView(views: readonly CenterViewExtension[], id: string | undefined): CenterViewExtension | null {
  return id === undefined ? null : (views.find((v) => v.id === id) ?? null);
}

/** 안쪽 HashRouter 를 쓰는 확장 보기인가(바깥 이동 뒤 popstate·소스 전환 때 실제 해시 유지). */
export function isHashRouted(views: readonly CenterViewExtension[], id: string | undefined): boolean {
  return findView(views, id)?.hashRouted === true;
}

/**
 * 확장 보기의 앵커. 안쪽 라우터면 실제 해시(`#/…`)를 그대로 쓰고(필터 값의 %26 같은 예약문자 인코딩은 풀지 않는다),
 * 아니면 그 보기의 첫 화면(home.anchor) 이다.
 */
export function viewAnchor(view: CenterViewExtension, hash: string): string {
  if (view.hashRouted === true && hash.startsWith('#/')) return hash.slice(1);
  return view.home.anchor ?? '';
}
