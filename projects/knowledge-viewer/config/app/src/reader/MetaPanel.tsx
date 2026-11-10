import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

import { hrefFor } from '../app/route.ts';
import { isPlainClick } from '../app/links.ts';
import { copyText } from '../panels/viewers-api.ts';
import { APP_UIS, appDocLinks, type ViewerAppUi } from '../apps/registry.ts';
import type { DocResponse, Source } from '../app/types.ts';
import { codePathTarget } from './code-paths.ts';
import { META_KEYS, mdLinkAccepts, metaItems, parseMetaValue, type MetaItem } from './meta-links.ts';
import { useCodePaths, type CodePathMap } from './useCodePaths.ts';

export function CopyPathButton({ path }: { path: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // 개인 이름(http, 보안 문맥 아님) 뒤에는 navigator.clipboard 가 없다 — copyText 가 textarea 로 물러선다.
  const copy = () => {
    void copyText(`@${path}`).then((ok) => {
      if (!ok) return;
      setDone(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDone(false), 1500);
    });
  };
  return (
    <button type="button" className="copy-path" onClick={copy}>
      {done ? '복사됨' : '경로 복사'}
    </button>
  );
}

export type MetaPanelProps = {
  doc: DocResponse;
  agent: boolean;
  src: Source;
  onNavigate: (path: string, anchor?: string) => void;
  /** 경로 후보 → 찾은 곳. 빼면 /api/resolve-paths 로 묻는다(useCodePaths — 리더와 같은 요청). 시험이 바꿔 끼운다. */
  paths?: CodePathMap;
  /** 앱 화면 등록부. 빼면 실제 등록부(APP_UIS). 시험이 바꿔 끼운다. */
  apps?: ViewerAppUi[];
};

type Env = Omit<MetaPanelProps, 'paths' | 'apps'> & { paths: CodePathMap | undefined };

function AppLink({ path, anchor, env, children }: { path: string; anchor: string; env: Env; children: ReactNode }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    env.onNavigate(path, anchor === '' ? undefined : anchor);
  };
  return (
    <a href={hrefFor(path, anchor, env.agent, env.src)} data-vault-path={path} onClick={onClick}>
      {children}
    </a>
  );
}

/** frontmatter 문자열 한 줄. 위키링크는 doc.links, 경로·md 링크는 찾은 곳 표, URL·$GITHUB_DIR 는 새 탭. 못 푼 것은 글 그대로다. */
function MetaValue({ item, env }: { item: MetaItem; env: Env }) {
  if (!item.parse) return <>{item.text}</>;
  return (
    <>
      {parseMetaValue(item.text).map((s, i) => {
        switch (s.kind) {
          case 'text':
            return s.text;
          case 'url':
            return (
              <a key={i} href={s.url} target="_blank" rel="noreferrer">
                {s.text}
              </a>
            );
          case 'wiki': {
            const link = env.doc.links.find((l) => l.kind === 'wiki' && l.target === s.target);
            if (link === undefined || link.path === null) {
              return (
                <span key={i} className="link-dead" title={`해석 안 됨: ${s.target}`}>
                  {s.text}
                </span>
              );
            }
            return (
              <AppLink key={i} path={link.path} anchor={s.anchor} env={env}>
                {s.text}
              </AppLink>
            );
          }
          case 'md': {
            const hit = env.paths?.[s.target];
            if (hit === undefined || hit === null || !mdLinkAccepts(env.doc.path, s.target, hit.path)) {
              // 묻는 중이면 글자만, 물었는데 없으면 본문처럼 끊긴 링크 모양이다.
              return hit === undefined ? (
                s.text
              ) : (
                <span key={i} className="link-dead" title={`해석 안 됨: ${s.target}`}>
                  {s.text}
                </span>
              );
            }
            const t = codePathTarget(s.target, hit);
            return (
              <AppLink key={i} path={t.path} anchor={t.kind === 'md' ? s.anchor : t.kind === 'app' ? t.anchor : ''} env={env}>
                {s.text}
              </AppLink>
            );
          }
          case 'path': {
            const hit = env.paths?.[s.text];
            if (hit === undefined || hit === null) return s.text;
            // 이미지·pdf(raw)도 앱 안 파일 보기로 연다 — 거기서 원본으로 간다.
            const t = codePathTarget(s.text, hit);
            return (
              <AppLink key={i} path={t.path} anchor={t.kind === 'raw' ? '' : t.anchor} env={env}>
                {s.text}
              </AppLink>
            );
          }
        }
      })}
    </>
  );
}

export function MetaPanel({ doc, agent, src, onNavigate, paths, apps = APP_UIS }: MetaPanelProps) {
  const fetched = useCodePaths(doc, paths === undefined);
  const env: Env = { doc, agent, src, onNavigate, paths: paths ?? fetched };
  const rows = META_KEYS.map((k) => [k, metaItems(doc.frontmatter[k])] as const).filter(([, v]) => v.length > 0);
  const { commit, dirty } = doc.stamp;
  // 이 문서를 다루는 앱이 있으면 "…에서 열기" 링크(전체 이동). appHref 와 같은 /apps/<id> 주소다.
  const appLinks = appDocLinks(apps, doc.path, agent);
  return (
    <div className="meta">
      {rows.length > 0 && (
        <dl className="meta-list">
          {rows.map(([k, v]) => (
            <div key={k} className="meta-row">
              <dt>{k}</dt>
              <dd>
                {v.length === 1 ? (
                  <MetaValue item={v[0]!} env={env} />
                ) : (
                  <ul>
                    {v.map((item, i) => (
                      <li key={i}>
                        <MetaValue item={item} env={env} />
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="meta-stamp">
        {commit === null ? '커밋 없음' : `커밋 ${commit}`}
        {dirty && <span className="meta-dirty"> · 변경 있음</span>}
      </p>
      {appLinks.length > 0 && (
        <ul className="meta-app-links">
          {appLinks.map((l) => (
            <li key={l.id}>
              <a href={l.href} data-app-id={l.id}>
                {l.title}에서 열기
              </a>
            </li>
          ))}
        </ul>
      )}
      <CopyPathButton path={doc.path} />
    </div>
  );
}
