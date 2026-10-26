// 출처: projects/project-viewer/config/shell/model/slug.ts (2026-10-23 복사)
// 헤딩 슬러그 — 검사기와 렌더러가 함께 쓰는 유일한 함수다.
// md 구조는 정규식이 아니라 AST에서 뽑는다(코드펜스 안의 #을 헤딩으로 오인하지 않기 위해서다).
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString } from 'mdast-util-to-string';
import { slug as githubSlug } from 'github-slugger';

import type { Heading } from './types.ts';

/**
 * `seen`은 호출자가 들고 있는 "이미 쓴 슬러그 → 충돌 횟수" 표다.
 * github-slugger의 인스턴스 동작(둘째부터 -1, -2 …)을 그대로 따른다.
 */
export function slugify(text: string, seen: Map<string, number>): string {
  const original = githubSlug(text);
  let result = original;
  while (seen.has(result)) {
    const next = (seen.get(original) ?? 0) + 1;
    seen.set(original, next);
    result = `${original}-${next}`;
  }
  seen.set(result, 0);
  return result;
}

/**
 * 받은 문자열 기준의 줄 번호를 돌려준다. frontmatter를 뗀 본문을 넣었다면
 * 원문 기준으로 맞추는 보정(`bodyStartLine - 1`)은 호출자가 한다.
 */
export function extractHeadings(markdown: string): Heading[] {
  const tree = fromMarkdown(markdown);
  const seen = new Map<string, number>();
  const headings: Heading[] = [];
  for (const node of tree.children) {
    if (node.type !== 'heading') continue;
    const text = toString(node).trim();
    headings.push({
      depth: node.depth,
      text,
      slug: slugify(text, seen),
      line: node.position?.start.line ?? 1,
    });
  }
  return headings;
}
