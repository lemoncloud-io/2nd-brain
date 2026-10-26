// 노트 임베드 상자. remarkEmbeds 가 `a[data-embed]` 로 표시한 링크를 리더가 이 상자로 바꾼다.
// 본문은 서버가 `/api/doc` 의 `embeds` 에 1단계만 실어 준다. 실린 것이 없으면(해석 못 함·범위 밖) `[[…]]` 링크 그대로다.
import type { ReactNode } from 'react';

import { embedKey, type EmbedMark } from '../../shared/embeds.ts';
import type { DocEmbed } from '../app/types.ts';
import { BodyLink, type LinkEnv } from './DocLink.tsx';
import { classifyHref } from './urls.ts';

export type EmbedBlockProps = {
  mark: EmbedMark;
  href: string | undefined;
  env: LinkEnv;
  embeds: Record<string, DocEmbed> | undefined;
  /** 링크 글자(별칭 또는 대상). */
  children: ReactNode;
  /** 실린 본문을 그린다. 리더가 같은 remark 파이프라인(임베드는 링크로)으로 그린다. */
  renderBody: (embed: Extract<DocEmbed, { status: 'ok' }>) => ReactNode;
};

/** 상자 안 안내 한 줄(순환·절 없음·블록 참조). */
function Notice({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <section className={`embed embed-notice embed-${kind}`} data-embed-status={kind}>
      <p className="embed-notice-text">{children}</p>
    </section>
  );
}

export function EmbedBlock({ mark, href, env, embeds, children, renderBody }: EmbedBlockProps) {
  const link = (
    <BodyLink href={href} env={env}>
      {children}
    </BodyLink>
  );
  if (mark === 'self') return <Notice kind="circular">순환 임베드 — 이 문서 자신은 품지 않는다: {link}</Notice>;
  if (mark === 'block') return <Notice kind="block">블록 참조 임베드(<code>#^…</code>)는 지원하지 않는다: {link}</Notice>;
  const c = classifyHref(href);
  if (c.kind !== 'wiki') return link;
  const embed = embeds?.[embedKey(c.target, c.anchor)];
  if (embed === undefined) return link;
  if (embed.status === 'circular') return <Notice kind="circular">순환 임베드 — 이 문서 자신은 품지 않는다: {link}</Notice>;
  if (embed.status === 'no-section') {
    return (
      <Notice kind="no-section">
        절을 찾지 못했다(<code>#{embed.anchor}</code>): {link}
      </Notice>
    );
  }
  return (
    <section className="embed" data-embed-path={embed.path}>
      <p className="embed-title">
        <BodyLink href={href} env={env}>
          {embed.title}
          {embed.anchor === null ? null : ` › ${embed.anchor}`}
        </BodyLink>
      </p>
      <div className="embed-body">{renderBody(embed)}</div>
    </section>
  );
}
