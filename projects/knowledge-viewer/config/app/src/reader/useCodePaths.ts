// 본문 인라인 코드 경로를 문서 한 번 그릴 때 요청 하나로 푼다(2026-10-27 오너 요청). 판정은 code-paths.ts(순수).
// 문서 정보 패널의 frontmatter 경로 후보(meta-links.ts)도 같은 목록에 싣는다 — 리더와 패널이 같은 키로 부르므로 요청은 하나다.
// 캐시는 소스·머리·문서·mtime·후보 목록 키로 묶는다 — 같은 문서로 돌아오면 다시 묻지 않는다. 실패하면 링크 없이 그대로 둔다.
import { useEffect, useMemo, useState } from 'react';

import type { CodePathHit } from '../../shared/code-path.ts';
import { resolveCodePaths } from '../app/api.ts';
import type { DocResponse } from '../app/types.ts';
import { codePathCandidates } from './code-paths.ts';
import { META_KEYS, metaPathCandidates } from './meta-links.ts';

export type CodePathMap = Record<string, CodePathHit | null>;

const CACHE_MAX = 64;
const cache = new Map<string, Promise<CodePathMap>>();

function lookup(key: string, load: () => Promise<CodePathMap>): Promise<CodePathMap> {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  const p = load().catch((e: unknown) => {
    cache.delete(key); // 실패는 기억하지 않는다 — 다음 그리기에 다시 묻는다.
    throw e;
  });
  cache.set(key, p);
  return p;
}

/** 문서 본문의 인라인 코드 경로 → 찾은 곳. 묻는 중·후보 없음·실패·꺼짐(enabled false)이면 undefined(링크 없이 그린다). */
export function useCodePaths(
  doc: Pick<DocResponse, 'source' | 'head' | 'path' | 'mtime' | 'body' | 'frontmatter'>,
  enabled = true,
): CodePathMap | undefined {
  const candidates = useMemo(() => codePathCandidates(doc.body, metaPathCandidates(doc.frontmatter, META_KEYS)), [doc.body, doc.frontmatter]);
  const key = `${doc.source}\0${doc.head ?? ''}\0${doc.path}\0${doc.mtime}\0${candidates.join('\n')}`;
  const [state, setState] = useState<{ key: string; map: CodePathMap } | null>(null);
  useEffect(() => {
    if (!enabled || candidates.length === 0) return;
    let live = true;
    lookup(key, () => resolveCodePaths(doc.path, candidates, doc.source).then((r) => r.paths)).then(
      (map) => live && setState({ key, map }),
      () => {},
    );
    return () => {
      live = false;
    };
    // key 가 candidates·doc 를 모두 담는다.
  }, [key, enabled]);
  return state !== null && state.key === key ? state.map : undefined;
}
