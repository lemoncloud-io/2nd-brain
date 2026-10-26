import { createElement, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import Markdown, { type Components, type Options } from 'react-markdown';
import { defaultHandlers, type Handlers } from 'mdast-util-to-hast';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { remarkCallouts } from '../../shared/callouts.ts';
import { remarkEmbeds, type EmbedMark } from '../../shared/embeds.ts';
import { GFM_OPTIONS, codeChangeOf, remarkChanged, remarkHeadingIds, remarkWikilinks } from '../../shared/markdown.ts';
import { MAIN } from '../../shared/source.ts';
import type { DocChange, DocEmbed, DocResponse, Source } from '../app/types.ts';
import { CalloutIcon } from './CalloutIcon.tsx';
import { CHANGED_SELECTOR } from './changed-dom.ts';
import { BodyLink, InlineCode, type LinkEnv } from './DocLink.tsx';
import { EmbedBlock } from './Embed.tsx';
import { frameOrigin, gitRawOrigin } from './frame.ts';
import { rehypeImageSrcToTitle, type ImageEnv } from './imageSrc.ts';
import { Mermaid, type BlockMarks } from './Mermaid.tsx';
import { isRemoteLoaded, markRemoteLoaded, useRemoteImages, type RemoteImageView } from './remote-images.ts';
import { SANITIZE_SCHEMA } from './sanitize.ts';
import { tableComponents } from './Table.tsx';
import { transformUrl } from './urls.ts';

type HastText = { type: string; value?: string };
type HastEl = { type: string; tagName?: string; properties?: { className?: unknown }; children?: Array<HastEl & HastText> };

/** `pre > code.language-mermaid`이면 그 소스를 돌려준다. */
function mermaidSource(node: HastEl | undefined): string | null {
  const code = node?.children?.[0];
  if (code?.type !== 'element' || code.tagName !== 'code') return null;
  const cls = code.properties?.className;
  if (!Array.isArray(cls) || !cls.includes('language-mermaid')) return null;
  return (code.children ?? []).map((c) => c.value ?? '').join('').replace(/\n$/, '');
}

/**
 * 코드 블록 핸들러. 기본 핸들러가 만든 `<pre>` 에 remarkChanged 의 표식(data.hChanged·hRemoved)을 옮긴다.
 * 안쪽 `<code>` 의 `language-*` 는 건드리지 않는다.
 */
export function codeHandler(agent: boolean): Handlers['code'] {
  return (state, node) => {
    const el = defaultHandlers.code(state, node);
    const mark = codeChangeOf(node);
    if (mark.hChanged === true) {
      if (agent) el.properties.dataChanged = '1';
      else {
        const cls = Array.isArray(el.properties.className) ? el.properties.className : [];
        el.properties.className = [...cls, 'changed'];
      }
    }
    if (mark.hRemoved !== undefined) el.properties.dataRemoved = String(mark.hRemoved);
    return el;
  };
}

/** react-markdown 이 넘긴 속성에서 블록 표식만 고른다. */
function marksOf(props: Record<string, unknown>): BlockMarks {
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
  return { className: str(props.className), 'data-changed': str(props['data-changed']), 'data-removed': str(props['data-removed']) };
}

const heading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
  const tag = `h${level}`;
  return function Heading({ node: _node, children, ...props }: ComponentProps<'h1'> & { node?: unknown }) {
    return createElement(tag, { ...props, 'data-anchor': props.id }, children);
  };
};

const isEmbedMark = (v: unknown): v is EmbedMark => v === 'note' || v === 'block' || v === 'self';

type BodyOptions = Pick<Options, 'remarkPlugins' | 'rehypePlugins' | 'remarkRehypeOptions'>;

/**
 * 본문 이미지. sanitize 뒤에 src 가 남은 것은 `data:`·볼트 이미지(`/raw/…`·git 출처)·허용 호스트 원격(`https://`, 토글 켬)뿐이다.
 * 볼트·원격 이미지는 누르면 같은 주소를 새 탭으로 연다(링크 안이면 겹치지 않는다). 못 읽으면(404 등) 배지로 되돌린다.
 * src 가 벗겨진 것은 원래 주소가 title 에 실려 있다 — 배지로 그리고, 원격이면 외부 링크를 단다.
 * `remoteAsk`(토글 켬 + 허용 밖 호스트)면 배지에 "불러오기" 를 단다 — 누를 때만 그 이미지 하나를 요청한다(이 탭에서 기억).
 */
function BodyImage(props: {
  src?: string;
  alt?: string;
  title?: string;
  width?: number | string;
  height?: number | string;
  inLink: boolean;
  remoteAsk?: string;
}) {
  const { alt, title, width, height, inLink, remoteAsk } = props;
  const [broken, setBroken] = useState(false);
  const [asked, setAsked] = useState(() => remoteAsk !== undefined && isRemoteLoaded(remoteAsk));
  const src = asked && remoteAsk !== undefined ? remoteAsk : props.src;
  if (typeof src !== 'string' || src === '' || broken) {
    const badge = (
      <span className="img-badge" title={alt === undefined || alt === '' ? undefined : alt} data-img-broken={broken ? '' : undefined}>
        이미지: {title === undefined || title === '' ? (alt ?? '') : title}
      </span>
    );
    // 원격 이미지는 요청하지 않는다 — 배지에 그 주소로 가는 외부 링크만 단다(누를 때만 연다).
    const linked =
      inLink || broken || title === undefined || !/^https?:\/\//i.test(title) ? (
        badge
      ) : (
        <a className="img-badge-link" href={title} target="_blank" rel="noreferrer">
          {badge}
        </a>
      );
    if (remoteAsk === undefined || broken) return linked;
    return (
      <span className="img-remote">
        {linked}
        <button
          type="button"
          className="img-load"
          title="이 이미지 하나만 바깥 호스트에서 불러온다"
          onClick={(e) => {
            // 링크 안 배지여도 링크로 가지 않는다.
            e.preventDefault();
            e.stopPropagation();
            markRemoteLoaded(remoteAsk);
            setAsked(true);
          }}
        >
          불러오기
        </button>
      </span>
    );
  }
  if (src.startsWith('data:')) return <img src={src} alt={alt} title={title} width={width} height={height} />;
  // 원격은 리퍼러를 싣지 않는다 — 볼트 문서 주소가 바깥 호스트로 가지 않게.
  const remote = /^https:\/\//i.test(src);
  const img = (
    <img
      src={src}
      alt={alt}
      title={title}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      referrerPolicy={remote ? 'no-referrer' : undefined}
      onError={() => setBroken(true)}
    />
  );
  if (inLink) return img;
  return (
    <a className="img-open" href={src} target="_blank" rel="noreferrer">
      {img}
    </a>
  );
}

/**
 * 본문 파이프라인. 임베드는 위키링크보다 먼저 돌아야 한다(`![[…]]` 의 `[[…]]` 를 위키링크가 먼저 먹지 않게).
 * `nested`(임베드 본문)는 헤딩 id·PR 표시 없이, 그 안의 노트 임베드는 링크로만 그린다.
 */
function bodyOptions(o: {
  agent: boolean;
  nested?: boolean;
  headings?: DocResponse['headings'];
  change?: DocChange;
  bodyStartLine: number;
  image?: ImageEnv;
}): BodyOptions {
  const nested = o.nested === true;
  const change = nested ? undefined : o.change;
  return {
    remarkPlugins: [
      [remarkGfm, GFM_OPTIONS],
      [remarkEmbeds, { nested }],
      remarkWikilinks,
      remarkCallouts,
      ...((nested ? [] : [[remarkHeadingIds, { headings: o.headings }]]) as NonNullable<Options['remarkPlugins']>),
      ...((change === undefined || change.status === null
        ? []
        : [[remarkChanged, { hunks: change.hunks, removed: change.removed, bodyStartLine: o.bodyStartLine, agent: o.agent }]]) as NonNullable<
        Options['remarkPlugins']
      >),
    ],
    rehypePlugins: [rehypeRaw, [rehypeImageSrcToTitle, o.image], [rehypeSanitize, SANITIZE_SCHEMA]],
    remarkRehypeOptions: { allowDangerousHtml: true, handlers: { code: codeHandler(o.agent) } },
  };
}

/** 임베드 본문. 링크·이미지는 실린 문서 기준(그 문서의 links·경로)으로 푼다. */
function EmbedBody({
  embed,
  env,
  agent,
  gitOrigin,
  remote,
}: {
  embed: Extract<DocEmbed, { status: 'ok' }>;
  env: LinkEnv;
  agent: boolean;
  gitOrigin: string;
  remote: RemoteImageView;
}) {
  const inner: LinkEnv = { ...env, links: embed.links, docPath: embed.path };
  const image: ImageEnv = { agent, docPath: embed.path, links: embed.links, src: env.src, gitOrigin, remote };
  return (
    <Markdown
      {...bodyOptions({ agent, nested: true, bodyStartLine: embed.bodyStartLine, image })}
      urlTransform={transformUrl}
      components={bodyComponents(inner, agent, undefined, gitOrigin, remote)}
    >
      {embed.body}
    </Markdown>
  );
}

/** 본문 요소 그리기. `embeds` 는 바깥 문서에만 있다 — 임베드 본문에는 `a[data-embed]` 가 생기지 않는다. */
function bodyComponents(env: LinkEnv, agent: boolean, embeds: DocResponse['embeds'], gitOrigin: string, remote: RemoteImageView): Components {
  return {
    a: ({ node: _node, href, children, ...rest }) => {
      const mark = (rest as Record<string, unknown>)['data-embed'];
      if (isEmbedMark(mark)) {
        return (
          <EmbedBlock mark={mark} href={href} env={env} embeds={embeds} renderBody={(e) => <EmbedBody embed={e} env={env} agent={agent} gitOrigin={gitOrigin} remote={remote} />}>
            {children}
          </EmbedBlock>
        );
      }
      return (
        <BodyLink href={href} env={env}>
          {children}
        </BodyLink>
      );
    },
    code: ({ className, children }) =>
      typeof children === 'string' ? (
        <InlineCode text={children} env={env} className={className} />
      ) : (
        <code className={className}>{children}</code>
      ),
    // 표식(changed·data-changed·data-removed)은 <pre> 또는 mermaid 그릇으로 옮긴다.
    pre: ({ node, children, ...rest }) => {
      const marks = marksOf(rest as Record<string, unknown>);
      const src = mermaidSource(node as HastEl | undefined);
      return src === null ? <pre {...marks}>{children}</pre> : <Mermaid code={src} marks={marks} />;
    },
    img: ({ node: _node, src, alt, title, width, height, ...rest }) => {
      const ask = (rest as Record<string, unknown>)['data-remote-ask'];
      return (
        <BodyImage
          key={typeof src === 'string' ? src : typeof ask === 'string' ? ask : ''}
          src={typeof src === 'string' ? src : undefined}
          alt={alt}
          title={title}
          width={width}
          height={height}
          inLink={(rest as Record<string, unknown>)['data-in-link'] === '1'}
          remoteAsk={typeof ask === 'string' ? ask : undefined}
        />
      );
    },
    // callout 제목 줄 아이콘(remarkCallouts 의 span.callout-icon). 그 밖의 span 은 그대로.
    span: ({ node: _node, ...props }) => {
      const cls = typeof props.className === 'string' ? props.className.split(' ') : [];
      if (!cls.includes('callout-icon')) return <span {...props} />;
      return (
        <span className={props.className} aria-hidden="true">
          <CalloutIcon name={(props as Record<string, unknown>)['data-icon']} />
        </span>
      );
    },
    // 표: 감싸개·셀 클래스·행 상세·열 폭. 에이전트 모드는 클래스만.
    ...tableComponents(agent),
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    h5: heading(5),
    h6: heading(6),
  };
}

export type ReaderProps = {
  doc: DocResponse;
  agent: boolean;
  /** 지금 소스. 본문 링크가 싣는다. 없으면 main(주소 기본). */
  src?: Source;
  /** 주소의 `#앵커`. 있으면 렌더 뒤 그 자리로 스크롤한다. */
  anchor?: string;
  onNavigate: (path: string, anchor?: string) => void;
  /** PR 이 이 문서에 한 일. 빼면 `doc.change`(src=pr:<n> 응답에만 있다). */
  change?: DocChange;
  /** /api/info 의 git 소스 출처 포트. 모르면 주 포트 + 1. */
  gitRawPort?: number | null;
  /** 원격 이미지 보기. 빼면 ⚙ 설정(remoteImageStore)을 따른다. 시험이 바꿔 끼운다. */
  remoteImages?: RemoteImageView;
};

/** 본문 위 한 줄 요약. 블록 수는 렌더 뒤에 센다. */
export function changeSummary(change: DocChange, blocks: number): string {
  if (change.status === 'A') return `이 PR 에서 새로 만든 문서 · 추가 ${change.added}줄`;
  return `이 PR 에서 추가 ${change.added}줄 · 삭제 ${change.deleted}줄 · 블록 ${blocks}개`;
}

export function Reader({ doc, agent, src = MAIN, anchor = '', onNavigate, change = doc.change, gitRawPort, remoteImages }: ReaderProps) {
  const ref = useRef<HTMLElement>(null);
  const stored = useRemoteImages();
  // 에이전트 모드는 텍스트 소비자다 — 토글과 무관하게 배지 그대로(imageSrc 도 agent 면 배지로 둔다).
  const remote = remoteImages ?? stored;
  const [changedBlocks, setChangedBlocks] = useState(0);

  // git 소스 이미지의 출처. SSR(시험)에는 location 이 없어 포트를 gitRawPort(없으면 기본)로만 정한다.
  const gitOrigin = gitRawOrigin(typeof location === 'undefined' ? '' : location.port, gitRawPort);

  const components = useMemo<Components>(() => {
    // SSR(시험)에는 location 이 없다. 그때는 출처 없이 상대 주소가 된다.
    const rawOrigin = typeof location === 'undefined' ? '' : frameOrigin(location.hostname, location.port, src, gitRawPort);
    const env: LinkEnv = { links: doc.links, agent, src, onNavigate, docPath: doc.path, rawOrigin };
    return bodyComponents(env, agent, doc.embeds, gitOrigin, remote);
  }, [doc.links, doc.path, doc.embeds, agent, src, onNavigate, gitRawPort, gitOrigin, remote]);

  const options = useMemo(
    () =>
      bodyOptions({
        agent,
        headings: doc.headings,
        change,
        bodyStartLine: doc.bodyStartLine,
        image: { agent, docPath: doc.path, links: doc.links, src, gitOrigin, remote },
      }),
    [doc.headings, doc.bodyStartLine, doc.path, doc.links, src, gitOrigin, change, agent, remote],
  );

  // 바뀐 블록 수는 그린 뒤 센다(원문 raw HTML 블록도 화면에 보이는 대로 센다). 지운 자리(data-removed)도 센다 — PR 상세 패널과 같은 셀렉터.
  useEffect(() => {
    setChangedBlocks(ref.current?.querySelectorAll(CHANGED_SELECTOR).length ?? 0);
  }, [doc, change, agent]);

  useEffect(() => {
    if (anchor !== '') document.getElementById(anchor)?.scrollIntoView({ block: 'start' });
    else ref.current?.closest('.col')?.scrollTo({ top: 0 });
  }, [doc.path, anchor]);

  const article = (
    <article ref={ref} className="doc" data-vault-path={doc.path}>
      <Markdown {...options} urlTransform={transformUrl} components={components}>
        {doc.body}
      </Markdown>
    </article>
  );
  if (change === undefined || change.status === null) return article;
  // 에이전트 모드는 색·글꼴 없이 글만 둔다.
  return (
    <>
      <p className={agent ? undefined : 'doc-change-summary'} data-change-summary="">
        {changeSummary(change, changedBlocks)}
      </p>
      {article}
    </>
  );
}
