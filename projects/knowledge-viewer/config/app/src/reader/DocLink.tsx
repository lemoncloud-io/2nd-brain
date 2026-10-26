import { useState, type MouseEvent, type ReactNode } from 'react';

import { hrefFor } from '../app/route.ts';
import { isPlainClick } from '../app/links.ts';
import type { DocLink as DocLinkInfo, Source } from '../app/types.ts';
import { isHtmlPath, rawHref } from './frame.ts';
import { PreviewLink } from './PreviewLink.tsx';
import { resolveRelative } from './relpath.ts';
import { classifyHref, isProvenancePath } from './urls.ts';

export type LinkEnv = {
  links: DocLinkInfo[];
  agent: boolean;
  /** 지금 소스. 앱 안 링크가 모두 싣는다. */
  src: Source;
  onNavigate: (path: string, anchor?: string) => void;
  /** 지금 문서의 볼트 경로. 상대 첨부 링크를 푸는 기준이다. */
  docPath: string;
  /** `/raw` 를 여는 출처(지금 소스로 부른 frameOrigin 의 값 — git 소스면 git 포트 출처). */
  rawOrigin: string;
};

function InAppLink(props: { path: string; anchor: string; env: LinkEnv; title?: string; children: ReactNode }) {
  const { path, anchor, env, title, children } = props;
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(e)) return; // 수정키 클릭은 브라우저가 새 탭 등으로 처리한다.
    e.preventDefault();
    env.onNavigate(path, anchor === '' ? undefined : anchor);
  };
  return (
    <a href={hrefFor(path, anchor, env.agent, env.src)} data-vault-path={path} title={title} onClick={onClick}>
      {children}
    </a>
  );
}

function Candidates({ paths, anchor, env }: { paths: string[]; anchor: string; env: LinkEnv }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="link-cands">
      <button type="button" className="cands-toggle" aria-expanded={open} title="같은 이름 문서가 여럿이다" onClick={() => setOpen(!open)}>
        ⧉
      </button>
      {open && (
        <span className="cands-list">
          {paths.map((p) => (
            <InAppLink key={p} path={p} anchor={anchor} env={env}>
              {p}
            </InAppLink>
          ))}
        </span>
      )}
    </span>
  );
}

/** 본문의 `a` 요소. 위키링크·상대 md는 `doc.links`로 해석해 앱 안 이동 링크로 그린다. */
export function BodyLink({ href, env, children }: { href: string | undefined; env: LinkEnv; children: ReactNode }) {
  const c = classifyHref(href);
  switch (c.kind) {
    case 'anchor':
      return <a href={`#${c.anchor}`}>{children}</a>;
    case 'external':
      return (
        <a href={c.url} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    case 'none':
      return <span>{children}</span>;
    case 'file': {
      const resolved = resolveRelative(env.docPath, c.target);
      if (resolved === null) {
        return (
          <span className="link-dead" title={`볼트 밖이다: ${c.target}`}>
            {children}
          </span>
        );
      }
      // html 은 앱 안 iframe 으로, 그 밖(첨부·이미지·pdf)은 원본을 새 탭으로 연다.
      if (isHtmlPath(resolved)) {
        return (
          <InAppLink path={resolved} anchor={c.anchor} env={env}>
            {children}
          </InAppLink>
        );
      }
      return (
        <a href={rawHref(env.rawOrigin, resolved, c.anchor === '' ? '' : `#${c.anchor}`, env.src)} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    }
    case 'wiki':
    case 'md': {
      const link = env.links.find((l) => l.kind === c.kind && l.target === c.target);
      if (link === undefined || link.path === null) {
        return (
          <span className="link-dead" title={`해석 안 됨: ${c.target}`}>
            {children}
          </span>
        );
      }
      const many = link.candidates.length >= 2;
      return (
        <>
          <PreviewLink
            path={link.path}
            anchor={c.anchor === '' ? null : c.anchor}
            href={hrefFor(link.path, c.anchor, env.agent, env.src)}
            agent={env.agent}
            src={env.src}
            onNavigate={env.onNavigate}
            title={many ? `후보 ${link.candidates.length}개: ${link.candidates.join(', ')}` : undefined}
          >
            {children}
          </PreviewLink>
          {many && <Candidates paths={link.candidates} anchor={c.anchor} env={env} />}
        </>
      );
    }
  }
}

/** 인라인 코드. `raw/…md`·`archive/…md` 꼴 출처 문자열이면 그 문서로 가는 링크로 감싼다. */
export function InlineCode({ text, env, className }: { text: string; env: LinkEnv; className?: string }) {
  if (className === undefined && isProvenancePath(text)) {
    return (
      <InAppLink path={text} anchor="" env={env}>
        <code>{text}</code>
      </InAppLink>
    );
  }
  return <code className={className}>{text}</code>;
}
