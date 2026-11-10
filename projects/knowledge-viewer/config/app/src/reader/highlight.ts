// 코드 구문 강조(파일 보기·md 코드 블록). highlight.js 코어와 언어 모듈은 처음 쓸 때 지연 import 한다(코드 분할 청크).
// hljs 가 낸 HTML 문자열은 DOM 에 넣지 않는다 — 작은 파서로 토큰 트리를 만들고 React 요소(span)로 그린다.
// 토큰 span 은 글자만 감싼다(class 하나, data-* 없음). 트리의 글자를 이어 붙이면 원문과 같다.
import { createElement, useEffect, useState, type ReactNode } from 'react';

import { LANG_LOADERS, type HlLang } from './highlight-langs.ts';

/** 토큰 트리 마디. 글자 또는 class 를 가진 span. */
export type HlNode = string | { cls: string; children: HlNode[] };

/** 이보다 큰 본문은 강조하지 않는다(지금처럼 단색). 글자 수 기준 상한과 줄 수 상한. */
export const MAX_HL_CHARS = 300_000;
export const MAX_HL_LINES = 10_000;

/** 강조해도 되는 크기인가. */
export function withinHlLimit(text: string): boolean {
  if (text.length > MAX_HL_CHARS) return false;
  // 줄 수는 줄바꿈 수로 센다(상한을 넘는 순간 멈춘다).
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) if (++n > MAX_HL_LINES) return false;
  return true;
}

// hljs 가 escapeHTML 로 바꾸는 다섯 글자와 숫자 참조를 되돌린다.
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescape(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * hljs 결과 HTML(`<span class="…">`·`</span>`·이스케이프한 글자만 있다)을 토큰 트리로. 그 밖의 태그는 없다고 보지만,
 * 짝이 안 맞는 닫는 태그는 버리고 닫히지 않은 span 은 끝에서 닫는다.
 */
export function parseHljsHtml(html: string): HlNode[] {
  const root: HlNode[] = [];
  const stack: HlNode[][] = [root];
  const re = /<span class="([^"]*)">|<\/span>|[^<]+|</g;
  for (const m of html.matchAll(re)) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) {
      // 여는 span: 새 마디를 지금 자리에 넣고 그 안으로 들어간다.
      const el = { cls: m[1], children: [] as HlNode[] };
      top.push(el);
      stack.push(el.children);
    } else if (m[0] === '</span>') {
      // 닫는 span: 한 단계 나온다(뿌리 밖으로는 나가지 않는다).
      if (stack.length > 1) stack.pop();
    } else {
      // 글자: 앞 글자와 이어 붙인다.
      const text = unescape(m[0]);
      const last = top[top.length - 1];
      if (typeof last === 'string') top[top.length - 1] = last + text;
      else top.push(text);
    }
  }
  return root;
}

/** 트리의 글자를 이어 붙인다(span 을 벗긴 원문). */
export function textOf(nodes: HlNode[]): string {
  return nodes.map((n) => (typeof n === 'string' ? n : textOf(n.children))).join('');
}

/**
 * 트리를 줄로 쪼갠다. 여러 줄에 걸친 span(블록 주석·템플릿 문자열)은 줄 끝에서 닫고 다음 줄에서 같은 class 로 다시 연다.
 * 줄 수는 `text.split('\n')` 과 같다(빈 줄은 빈 배열).
 */
export function splitHlLines(nodes: HlNode[]): HlNode[][] {
  type Open = { id: number; cls: string };
  // 1) 평평하게: 글자 조각마다 그 조각을 감싼 span 경로(바깥 → 안).
  const runs: { text: string; path: Open[] }[] = [];
  let seq = 0;
  const walk = (list: HlNode[], path: Open[]): void => {
    for (const n of list) {
      if (typeof n === 'string') runs.push({ text: n, path });
      else walk(n.children, [...path, { id: seq++, cls: n.cls }]);
    }
  };
  walk(nodes, []);

  // 2) 줄마다 다시 쌓는다. 같은 원래 span(id)이 이어지면 같은 줄 안에서는 한 마디로 둔다.
  const lines: HlNode[][] = [[]];
  const ids: WeakMap<object, number> = new WeakMap();
  const put = (line: HlNode[], path: Open[], text: string): void => {
    let list = line;
    for (const o of path) {
      const last = list[list.length - 1];
      if (last !== undefined && typeof last !== 'string' && ids.get(last) === o.id) list = last.children;
      else {
        // 이 줄에서 처음 여는 span(또는 다음 줄에서 다시 여는 span).
        const el = { cls: o.cls, children: [] as HlNode[] };
        ids.set(el, o.id);
        list.push(el);
        list = el.children;
      }
    }
    const last = list[list.length - 1];
    if (typeof last === 'string') list[list.length - 1] = last + text;
    else list.push(text);
  };
  for (const r of runs) {
    const parts = r.text.split('\n');
    parts.forEach((p, i) => {
      // 줄바꿈마다 새 줄. 줄바꿈 글자 자체는 어느 줄에도 넣지 않는다.
      if (i > 0) lines.push([]);
      if (p !== '') put(lines[lines.length - 1]!, r.path, p);
    });
  }
  return lines;
}

/** 토큰 트리 → React 요소. span 은 class 만 단다. */
export function renderHl(nodes: HlNode[]): ReactNode[] {
  return nodes.map((n, i) => (typeof n === 'string' ? n : createElement('span', { key: i, className: n.cls }, ...renderHl(n.children))));
}

/** hljs 에서 이 파일이 쓰는 부분(구조 타입). */
export type Highlighter = {
  highlight(code: string, options: { language: string; ignoreIllegals?: boolean }): { value: string };
};

type HljsCore = Highlighter & { getLanguage(name: string): unknown; registerLanguage(name: string, fn: never): void };

// 코어는 한 번만, 언어는 언어마다 한 번만 불러온다(동적 import → 청크 분할).
let corePromise: Promise<HljsCore> | null = null;
const langPromises = new Map<HlLang, Promise<Highlighter>>();

/** 언어 하나를 등록한 hljs 를 돌려준다. */
export function loadHighlighter(lang: HlLang): Promise<Highlighter> {
  let p = langPromises.get(lang);
  if (p === undefined) {
    corePromise ??= import('highlight.js/lib/core').then((m) => m.default as unknown as HljsCore);
    p = Promise.all([corePromise, LANG_LOADERS[lang]()]).then(([hljs, mod]) => {
      // 같은 이름으로 두 번 등록하지 않는다.
      if (hljs.getLanguage(lang) === undefined) hljs.registerLanguage(lang, mod.default as never);
      return hljs;
    });
    // 실패하면 다음에 다시 시도할 수 있게 지운다.
    p.catch(() => langPromises.delete(lang));
    langPromises.set(lang, p);
  }
  return p;
}

/** 강조 한 번(순수 — hljs 를 받는다). 원문과 글자가 다르면(예상 밖 출력) null 로 단색을 고른다. */
export function highlightNodes(hljs: Highlighter, code: string, lang: HlLang): HlNode[] | null {
  try {
    const nodes = parseHljsHtml(hljs.highlight(code, { language: lang, ignoreIllegals: true }).value);
    return textOf(nodes) === code ? nodes : null;
  } catch {
    // 문법 모듈 예외는 단색으로 둔다.
    return null;
  }
}

/**
 * 코드를 강조한 토큰 트리. 언어가 없거나·끈 상태·상한 초과·불러오는 중이면 null(그때는 단색으로 그린다).
 * SSR(시험)에서는 effect 가 돌지 않아 늘 null 이다.
 */
export function useHighlight(code: string, lang: HlLang | null, enabled = true): HlNode[] | null {
  const on = enabled && lang !== null && withinHlLimit(code);
  const [got, setGot] = useState<{ code: string; lang: HlLang; nodes: HlNode[] | null } | null>(null);
  useEffect(() => {
    if (!on || lang === null) return;
    let live = true;
    // 불러온 뒤 지금 코드·언어 그대로면 그린다.
    loadHighlighter(lang).then(
      (hljs) => live && setGot({ code, lang, nodes: highlightNodes(hljs, code, lang) }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [on, code, lang]);
  return on && got !== null && got.code === code && got.lang === lang ? got.nodes : null;
}
