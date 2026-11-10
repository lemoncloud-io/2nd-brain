import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';

import { isPlainClick } from '../app/links.ts';
import { hrefFor } from '../app/route.ts';
import type { LinkEnv } from './DocLink.tsx';
import { rawHref } from './frame.ts';
import { mermaidLinkTarget, nodeIdFromGroupId, parseMermaidClicks } from './mermaid-links.ts';

import { useMermaidTheme } from './mermaid-theme-prefs.ts';
import { DEFAULT_THEME, findTheme, resolveDark } from '../app/themes.ts';
import { findMermaidTheme, type MermaidTheme, type ScreenPalette } from './mermaid-themes/registry.ts';
import { screenPaletteFrom } from './mermaid-themes/types.ts';

type MermaidApi = typeof import('mermaid').default;

// 모듈 하나당 한 번만 불러온다. 번들 분할을 위해 동적 import를 쓴다. 초기화는 테마·다크가 바뀔 때마다 다시 한다.
let apiPromise: Promise<MermaidApi> | null = null;
const loadMermaid = (): Promise<MermaidApi> => (apiPromise ??= import('mermaid').then((m) => m.default));

// 화면 상태 = 화면 테마 id + 다크 여부. <html data-theme data-scheme>(src/app/theme-apply.ts)와 OS 설정에서 읽는다.
// 다크 판정은 tokens.css 와 같다 — data-scheme 가 있으면 그것, 없으면 OS 설정(src/app/themes.ts resolveDark).
type Screen = { theme: string; dark: boolean };

const osDark = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

function screenKey(): string {
  if (typeof document === 'undefined') return `${DEFAULT_THEME}|l`;
  const ds = document.documentElement.dataset;
  return `${findTheme(ds['theme']).id}|${resolveDark(ds['scheme'], osDark()) ? 'd' : 'l'}`;
}

const subscribeScreen = (fn: () => void): (() => void) => {
  const offs: (() => void)[] = [];
  if (typeof matchMedia === 'function') {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', fn);
    offs.push(() => mq.removeEventListener('change', fn));
  }
  if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
    const mo = new MutationObserver(fn);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-scheme'] });
    offs.push(() => mo.disconnect());
  }
  return () => offs.forEach((off) => off());
};

const useScreen = (): Screen => {
  const key = useSyncExternalStore(subscribeScreen, screenKey, () => `${DEFAULT_THEME}|l`);
  // 키가 같으면 같은 객체 — effect 의존성으로 쓴다.
  return useMemo(() => {
    const [theme, d] = key.split('|');
    return { theme: theme!, dark: d === 'd' };
  }, [key]);
};

/** 화면 테마가 기본이 아니면 그 토큰 값. 기본이면 undefined(다이어그램 테마의 내장 팔레트). */
function screenPalette(screen: Screen): ScreenPalette | undefined {
  if (screen.theme === DEFAULT_THEME || typeof getComputedStyle === 'undefined') return undefined;
  const cs = getComputedStyle(document.documentElement);
  return screenPaletteFrom((v) => cs.getPropertyValue(v)) ?? undefined;
}

const cache = new Map<string, string>();
let seq = 0;
let initialized: string | null = null;
// mermaid.render는 임시 요소를 body에 만든다. 겹쳐 부르지 않도록 한 줄로 세운다.
let chain: Promise<unknown> = Promise.resolve();

const cacheKey = (theme: MermaidTheme, screen: Screen, code: string) => `${theme.id}:${screen.theme}:${screen.dark ? 'd' : 'l'}\n${code}`;

function renderSvg(theme: MermaidTheme, screen: Screen, code: string): Promise<string> {
  const key = cacheKey(theme, screen, code);
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const run = async (): Promise<string> => {
    const mermaid = await loadMermaid();
    // initialize 는 설정을 통째로 새로 잡는다. 다이어그램 테마·화면 테마·다크 짝이 바뀌었을 때만 다시 부른다.
    const initKey = `${theme.id}:${screen.theme}:${screen.dark ? 'd' : 'l'}`;
    if (initialized !== initKey) {
      mermaid.initialize({ ...theme.init(screen.dark, screenPalette(screen)), startOnLoad: false, securityLevel: 'strict' });
      initialized = initKey;
    }
    const id = `mmd-${(seq += 1)}`;
    try {
      const { svg } = await mermaid.render(id, code);
      cache.set(key, svg);
      return svg;
    } finally {
      // 실패해도 mermaid가 남긴 임시 요소를 치운다.
      document.getElementById(`d${id}`)?.remove();
    }
  };
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
}

const THEME_STYLE_ID = 'mermaid-theme-css';

/** 테마의 그릇 CSS 를 <head> 에 하나로 둔다. 테마를 바꾸면 통째로 바뀐다. */
function useThemeCss(theme: MermaidTheme): void {
  useEffect(() => {
    let el = document.getElementById(THEME_STYLE_ID);
    if (el === null) {
      el = document.createElement('style');
      el.id = THEME_STYLE_ID;
      document.head.append(el);
    }
    const css = theme.css ?? '';
    if (el.textContent !== css) el.textContent = css;
  }, [theme]);
}

type State = { svg: string } | { error: string } | null;

/** 바깥 그릇에 그대로 옮기는 블록 표식(PR 변경). `<pre>` 대신 그려도 표식이 남아야 한다. */
export type BlockMarks = { className?: string; 'data-changed'?: string; 'data-removed'?: string };

const withMarks = (base: string, marks: BlockMarks | undefined, themeId: string) => ({
  className: [base, marks?.className].filter((c) => c !== undefined && c !== '').join(' '),
  'data-changed': marks?.['data-changed'],
  'data-removed': marks?.['data-removed'],
  'data-mermaid-theme': themeId,
});

const XLINK = 'http://www.w3.org/1999/xlink';
const SVG_NS = 'http://www.w3.org/2000/svg';

/** svg `a` 의 주소를 바꾼다. href·xlink:href 를 같이 둔다(브라우저마다 읽는 쪽이 다르다). */
function setLinkHref(a: Element, href: string | null): void {
  if (href === null) {
    a.removeAttribute('href');
    a.removeAttributeNS(XLINK, 'href');
    return;
  }
  a.setAttribute('href', href);
  a.setAttributeNS(XLINK, 'xlink:href', href);
}

/**
 * 그린 svg 의 노드 링크(`click` 문법 → `<a>`)를 뷰어 링크로 바꾼다. 캐시된 svg 문자열은 그대로 두고 DOM 만 고친다.
 * 원래 주소는 `data-mermaid-href` 에 남겨 env 가 바뀌어 다시 돌아도 같은 결과다.
 */
function applyLinks(root: HTMLElement, code: string, env: LinkEnv): void {
  const clicks = parseMermaidClicks(code);
  for (const a of root.querySelectorAll('svg a')) {
    // 첫 적용 때 mermaid 가 낸 주소를 보관한다.
    let orig = a.getAttribute('data-mermaid-href');
    if (orig === null) {
      orig = a.getAttribute('href') ?? a.getAttributeNS(XLINK, 'href') ?? '';
      a.setAttribute('data-mermaid-href', orig);
    }
    const t = mermaidLinkTarget(env.docPath, orig);
    a.removeAttribute('data-vault-path');
    a.removeAttribute('data-vault-anchor');
    a.removeAttribute('target');
    a.removeAttribute('rel');
    if (t.kind === 'doc') {
      // 앱 안 문서: 주소는 hrefFor(에이전트·소스 질의 포함), 클릭은 위임 핸들러가 SPA 이동으로 받는다.
      setLinkHref(a, hrefFor(t.path, t.anchor, env.agent, env.src));
      a.setAttribute('data-vault-path', t.path);
      if (t.anchor !== '') a.setAttribute('data-vault-anchor', t.anchor);
    } else if (t.kind === 'file') {
      // 첨부·이미지 등은 본문 링크처럼 원본을 새 탭으로 연다.
      setLinkHref(a, rawHref(env.rawOrigin, t.path, t.anchor === '' ? '' : `#${t.anchor}`, env.src));
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noreferrer');
    } else if (t.kind === 'external') {
      setLinkHref(a, t.url);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noreferrer');
    } else if (t.kind === 'anchor') {
      setLinkHref(a, `#${t.anchor}`);
    } else {
      // 볼트 밖·해석 안 되는 주소는 링크를 끈다.
      setLinkHref(a, null);
    }
    // 툴팁: mermaid 는 JS 바인딩으로만 붙여 svg 에 없다. 소스의 click 줄에서 읽어 <title> 로 단다.
    const group = a.querySelector('g[id]');
    const nodeId = group === null ? null : nodeIdFromGroupId(group.id);
    const tip = nodeId === null ? undefined : clicks.get(nodeId)?.tooltip;
    if (tip !== undefined && a.querySelector(':scope > title') === null) {
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = tip;
      a.prepend(title);
    }
  }
}

export function Mermaid({ code, marks, env }: { code: string; marks?: BlockMarks; env?: LinkEnv }) {
  const theme = findMermaidTheme(useMermaidTheme());
  const screen = useScreen();
  useThemeCss(theme);
  const [state, setState] = useState<State>(() => {
    const hit = cache.get(cacheKey(theme, screen, code));
    return hit === undefined ? null : { svg: hit };
  });

  useEffect(() => {
    let live = true;
    const hit = cache.get(cacheKey(theme, screen, code));
    // 테마가 바뀌면 다시 그리는 동안 이전 그림을 유지한다(깜빡임 대신 교체). 처음이면 대기 문구다.
    if (hit !== undefined) {
      setState({ svg: hit });
      return;
    }
    renderSvg(theme, screen, code).then(
      (svg) => live && setState({ svg }),
      (e: unknown) => live && setState({ error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [code, theme, screen]);

  const box = useRef<HTMLDivElement>(null);
  // 그림이 바뀌거나 링크 환경이 바뀌면 노드 링크를 다시 적용한다.
  useEffect(() => {
    if (env === undefined || box.current === null || state === null || 'error' in state) return;
    applyLinks(box.current, code, env);
  }, [state, env, code]);

  // 노드 링크 클릭 위임: 앱 안 문서면 전체 새로고침 없이 이동한다. 수정키 클릭은 브라우저 몫이다.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (env === undefined || !isPlainClick(e)) return;
    const a = (e.target as Element).closest('a[data-vault-path]');
    if (a === null || !e.currentTarget.contains(a)) return;
    e.preventDefault();
    const anchor = a.getAttribute('data-vault-anchor');
    env.onNavigate(a.getAttribute('data-vault-path')!, anchor === null ? undefined : anchor);
  };

  if (state === null) return <div {...withMarks('mermaid mermaid-pending', marks, theme.id)}>다이어그램 그리는 중…</div>;
  if ('error' in state) {
    return (
      <div {...withMarks('mermaid mermaid-error', marks, theme.id)}>
        <p className="mermaid-error-line">Mermaid 해석 오류: {state.error.split('\n')[0]}</p>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  // mermaid strict 모드가 정화한 svg다. dangerouslySetInnerHTML은 여기서만 쓴다.
  return <div ref={box} {...withMarks('mermaid', marks, theme.id)} onClick={onClick} dangerouslySetInnerHTML={{ __html: state.svg }} />;
}
