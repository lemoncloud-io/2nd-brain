// 통합 보기의 주입 지점. 바깥 앱(볼트 뷰어)이 ProjectViewer 에 host 를 넘기면 어댑터(bundle·router·useRoute·theme)가 여기서 읽는다.
// 셸 단독 빌드는 이 폴더를 부르지 않는다. 한 화면에 셸 하나만 그린다는 전제다(지금 그리는 것 하나를 모듈 상태로 둔다) —
// 셸 화면 코드가 데이터를 모듈 최상위에서 한 번 받는 구조라서다(src/bundle.ts).
import type { Bundle } from '../../model/types.ts';

/** 바깥 앱의 밝기. 셸은 이 값만 본다(셸의 테마 단추는 통합 보기에서 숨긴다). */
export type EmbedTheme = 'light' | 'dark';

export interface EmbedHost {
  /** 지금 셸 라우트 해시(`#/p/…`). 셸 라우트가 아니면 ''. */
  readHash(): string;
  /** 셸 라우트를 쓴다. replace 면 방문 기록을 남기지 않는다. */
  writeHash(hash: string, replace: boolean): void;
  /** 라우트가 바뀌면(뒤로·앞으로 포함) cb 를 부른다. 해제 함수를 돌려준다. */
  subscribe(cb: () => void): () => void;
  /** 원본 문서(볼트 상대경로)의 주소. anchor 는 절 슬러그나 줄 앵커(`L12`)다. */
  docHref(path: string, anchor?: string): string;
  /** 원본 문서를 앱 안에서 연다. replace 면 지금 기록을 바꾼다. */
  openDoc(path: string, anchor?: string, replace?: boolean): void;
  /** 바깥 앱의 지금 밝기. */
  theme: EmbedTheme;
}

type State = { bundle: Bundle; host: EmbedHost; root: HTMLElement | null };

let state: State | null = null;
/** 원본 문서 주소 → 경로·앵커. 루트의 클릭 위임이 앱 안 이동으로 바꿀 때 찾는다(router 어댑터가 채운다). */
const docLinks = new Map<string, { path: string; anchor?: string }>();
const DOC_LINKS_MAX = 2_000;

/** 그리기 전에 지금 셸의 데이터와 host 를 둔다(ProjectViewer 가 부른다). */
export function setEmbed(bundle: Bundle, host: EmbedHost): void {
  if (state !== null && state.bundle !== bundle) docLinks.clear();
  state = { bundle, host, root: state?.root ?? null };
}

/** 셸 루트 요소(스크롤·요소 찾기의 기준). 마운트·해제 때 ProjectViewer 가 부른다. */
export function setEmbedRoot(root: HTMLElement | null): void {
  if (state !== null) state.root = root;
}

/** 지금 데이터. 그리기 전에 setEmbed 를 부르지 않았으면 예외다. */
export function embedBundle(): Bundle {
  if (state === null) throw new Error('통합 보기: ProjectViewer 밖에서 셸 화면을 그렸다');
  return state.bundle;
}

/** 지금 host. */
export function embedHost(): EmbedHost {
  if (state === null) throw new Error('통합 보기: ProjectViewer 밖에서 셸 화면을 그렸다');
  return state.host;
}

/** 지금 셸 루트 요소. 마운트 전이면 null. */
export function embedRoot(): HTMLElement | null {
  return state?.root ?? null;
}

/** 원본 문서 주소를 기억해 둔다(클릭을 앱 안 이동으로 바꿀 때 쓴다). 너무 쌓이면 비운다. */
export function rememberDocLink(href: string, path: string, anchor?: string): string {
  if (docLinks.size >= DOC_LINKS_MAX) docLinks.clear();
  docLinks.set(href, anchor === undefined ? { path } : { path, anchor });
  return href;
}

/** 기억해 둔 원본 문서 주소면 경로·앵커. */
export function docLinkOf(href: string): { path: string; anchor?: string } | undefined {
  return docLinks.get(href);
}
