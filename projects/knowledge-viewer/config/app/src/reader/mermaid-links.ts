// Mermaid 노드 클릭 링크(표준 `click` 문법) 해석. 순수 함수만 둔다 — DOM 적용은 Mermaid.tsx 가 한다.
import { resolveRelative } from './relpath.ts';
import { classifyHref } from './urls.ts';

/** `click` 줄 하나에서 읽은 링크. 툴팁은 없을 수 있다. */
export type MermaidClick = { href: string; tooltip?: string };

/** 링크 주소를 지금 문서 기준으로 푼 결과. */
export type MermaidLinkTarget =
  | { kind: 'doc'; path: string; anchor: string }
  | { kind: 'file'; path: string; anchor: string }
  | { kind: 'external'; url: string }
  | { kind: 'anchor'; anchor: string }
  | { kind: 'none' };

// `click ID "url" "tip"` 과 `click ID href "url" "tip"`. 뒤의 target(_blank 등)은 읽지 않는다.
const CLICK_LINE = /^\s*click\s+(\S+)\s+(?:href\s+)?"([^"]*)"(?:\s+"([^"]*)")?/;

/** 소스의 `click` 줄을 노드 id → 링크로 모은다. 콜백(`call fn()`·`fn`)은 무시한다. */
export function parseMermaidClicks(code: string): Map<string, MermaidClick> {
  const out = new Map<string, MermaidClick>();
  for (const line of code.split('\n')) {
    const m = CLICK_LINE.exec(line);
    // 따옴표 주소가 없는 줄(콜백)은 정규식에 걸리지 않는다.
    if (m === null) continue;
    const [, id, href, tooltip] = m;
    // 쉼표로 묶은 여러 id(`click A,B "x"`)도 각각 같은 링크다.
    for (const one of id!.split(',')) {
      if (one === '') continue;
      out.set(one, tooltip === undefined || tooltip === '' ? { href: href! } : { href: href!, tooltip });
    }
  }
  return out;
}

/** svg 노드 그룹 id(`<svgId>-flowchart-<노드>-<n>`)에서 노드 id 를 꺼낸다. 다른 꼴이면 null. */
export function nodeIdFromGroupId(groupId: string): string | null {
  const m = /-flowchart-(.+)-\d+$/.exec(groupId);
  return m === null ? null : m[1]!;
}

/** svg `a` 의 주소를 지금 문서(`docPath`) 기준으로 푼다. md·폴더·html 은 앱 안 문서, 그 밖 상대 경로는 원본 파일이다. */
export function mermaidLinkTarget(docPath: string, href: string | null | undefined): MermaidLinkTarget {
  const c = classifyHref(href ?? undefined);
  switch (c.kind) {
    case 'external':
      return { kind: 'external', url: c.url };
    case 'anchor':
      return { kind: 'anchor', anchor: c.anchor };
    case 'md':
    case 'file': {
      // 문서 기준 상대 경로만 받는다. 볼트 밖·절대 경로는 링크가 아니다.
      const path = resolveRelative(docPath, c.target);
      if (path === null) return { kind: 'none' };
      const doc = c.kind === 'md' || /\.html?$/i.test(path);
      return { kind: doc ? 'doc' : 'file', path, anchor: c.anchor };
    }
    default:
      // 위키링크 꼴·그 밖 스킴은 Mermaid click 에서 쓰지 않는다.
      return { kind: 'none' };
  }
}
