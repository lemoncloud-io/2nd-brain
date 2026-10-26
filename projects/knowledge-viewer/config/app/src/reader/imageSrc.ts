// 이미지 src 정리. sanitize 앞에서 img 마다 그릴지(볼트 이미지 → 지금 소스의 /raw 주소) 배지로 둘지를 정한다.
// 배지로 둘 것은 원래 주소를 title 칸에 실어 두고 src 를 지운다 — 배지가 "이미지: <주소>"를 보여 줄 수 있게.
// 원격 `https:` 이미지는 사용자가 토글을 켰을 때만 남긴다 — 허용 호스트는 src 그대로, 그 밖은 배지 + "불러오기"(data-remote-ask).
// 정화(SANITIZE_SCHEMA)는 여기서 만든 꼴(`data:`·`/raw/…`·git 출처 `/raw/@…`·`https://`)만 다시 통과시킨다. 순수 함수만 둔다.
import { httpsImage, imageMode, isAllowedHost, isRawImagePath, stripQueryHash } from '../../shared/image-src.ts';
import type { Source } from '../../shared/source.ts';
import { frameSrc } from './frame.ts';
import { resolveRelative } from './relpath.ts';

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/** 위키 이미지 임베드의 경로를 찾을 링크(`/api/doc` 의 links). 서버가 이미지 목록으로 path 를 채워 둔다. */
export type ImageLink = { kind: string; target: string; embed: boolean; path: string | null };

/** 볼트 이미지를 그릴 때 필요한 것. 없으면(옛 호출) 볼트 이미지도 배지다. */
export type ImageEnv = {
  /** 에이전트 모드는 텍스트 소비자다 — 이미지 바이트를 긁지 않게 배지 그대로 둔다. */
  agent: boolean;
  /** 지금 문서(임베드 본문이면 실린 문서)의 볼트 경로. 상대경로를 푸는 기준이다. */
  docPath: string;
  links: readonly ImageLink[];
  /** 지금 소스. 없으면 local. */
  src?: Source;
  /** git 소스 /raw 출처(gitRawOrigin). local 은 쓰지 않는다. */
  gitOrigin: string;
  /** 원격 이미지 보기(⚙ 토글·허용 호스트). 없거나 끔이면 원격은 배지다. */
  remote?: { enabled: boolean; hosts: readonly string[] };
};

/**
 * 원격 이미지를 어떻게 둘지. `show` 는 바로 그리고, `ask` 는 배지에 "불러오기" 를 단다. 그 밖은 배지만.
 * 토글 끔·에이전트·`https:` 아님(`http:`·`//host`)·사용자 정보 주소는 배지다.
 */
export function remoteImageDecision(
  src: string,
  env: ImageEnv | undefined,
): { kind: 'show' | 'ask'; href: string } | { kind: 'badge' } {
  if (env === undefined || env.agent || env.remote?.enabled !== true) return { kind: 'badge' };
  const img = httpsImage(src);
  if (img === null) return { kind: 'badge' };
  return { kind: isAllowedHost(img.host, env.remote.hosts) ? 'show' : 'ask', href: img.href };
}

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * 볼트 이미지 주소. local 은 같은 출처 `/raw/<경로>`(svg 는 서버가 localhost 로 302),
 * git 소스는 git 포트 출처 `http://localhost:<git 포트>/raw/@main|@pr/<n>/<경로>` 다(판정 12).
 */
export function rawImageUrl(path: string, src: Source | undefined, gitOrigin: string): string {
  const rel = frameSrc(path, '', src);
  return src === undefined || src.kind === 'local' ? rel : gitOrigin + rel;
}

/** 이 img 가 그릴 볼트 경로. 위키 임베드는 링크 표, `![](…)` 는 문서 기준 상대경로다. 볼트 밖·이미지 아님은 null. */
export function vaultImagePath(shown: string, wiki: boolean, env: ImageEnv): string | null {
  if (wiki) {
    const link = env.links.find((l) => l.kind === 'wiki' && l.embed && l.target === shown);
    const p = link?.path ?? null;
    return p !== null && isRawImagePath(p) ? p : null;
  }
  if (imageMode(shown) !== 'raw') return null;
  const p = resolveRelative(env.docPath, stripQueryHash(shown));
  return p !== null && isRawImagePath(p) ? p : null;
}

/**
 * hast 트리의 `img` 를 고친다(제자리). `data:` 는 그대로, 볼트 이미지는 /raw 주소 + title 에 원 경로 + lazy·async,
 * 원격은 remoteImageDecision 대로(show 는 정규 주소 + lazy·async, ask 는 배지 + data-remote-ask),
 * 그 밖은 src 를 title 로 옮기고 지운다. 링크 안이면 둘 다 `data-in-link`(리더가 새 탭·외부 링크를 겹치지 않게).
 * 위키 임베드 표시(`dataWikiEmbed`)는 여기서 떼어 정화에 닿지 않게 한다.
 */
export function moveImageSrcToTitle(node: HastNode, env?: ImageEnv, inLink = false): void {
  if (node.type === 'element' && node.tagName === 'img') {
    const props = (node.properties ??= {});
    const wiki = props.dataWikiEmbed !== undefined;
    delete props.dataWikiEmbed;
    // "불러오기" 표시는 여기서만 단다 — 본문 HTML 이 적어 둔 것은 지운다.
    delete props.dataRemoteAsk;
    const src = typeof props.src === 'string' ? props.src : '';
    // mdast-util-to-hast 가 url 을 퍼센트 인코딩했다. 경로 풀이와 호버 글자는 푼 꼴로 한다.
    const shown = safeDecode(src.trim());
    if (!wiki && imageMode(src) === 'inline') return;
    const path = env === undefined || env.agent ? null : vaultImagePath(shown, wiki, env);
    props.title = shown;
    if (inLink) props.dataInLink = '1';
    const remote = path === null && !wiki ? remoteImageDecision(src, env) : ({ kind: 'badge' } as const);
    if (remote.kind === 'show') {
      props.src = remote.href;
      props.loading = 'lazy';
      props.decoding = 'async';
    } else if (path === null) {
      delete props.src;
      if (remote.kind === 'ask') props.dataRemoteAsk = remote.href;
    } else {
      props.src = rawImageUrl(path, env!.src, env!.gitOrigin);
      props.loading = 'lazy';
      props.decoding = 'async';
    }
  }
  const here = inLink || (node.type === 'element' && node.tagName === 'a');
  for (const child of node.children ?? []) moveImageSrcToTitle(child, env, here);
}

/** rehype 플러그인. rehypeRaw 뒤, rehypeSanitize 앞에 둔다. */
export function rehypeImageSrcToTitle(env?: ImageEnv): (tree: HastNode) => void {
  return (tree) => moveImageSrcToTitle(tree, env);
}
