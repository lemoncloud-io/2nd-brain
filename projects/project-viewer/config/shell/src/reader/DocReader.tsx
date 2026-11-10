// 원본 한 편의 본문. 원문은 글자 하나도 바꾸지 않고, 바꾸는 일은 전부 AST 단계에서 한다.

import { useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { Components, Options } from 'react-markdown';

import type { SourceDoc } from '../../model/types.ts';
import { scrollRoot, scrollToId } from '../app/useRoute.ts';
import { formatRoute } from '../app/router.ts';
import { classifyLink } from './links.ts';
import { GFM_OPTIONS, imageMode, remarkHeadingIds, remarkHtmlAsText, remarkWikilinks } from './markdown.ts';

// 플러그인 목록의 타입은 렌더러가 내보낸 것에서 뽑는다 — 선언하지 않은 unified를 직접 import하지 않으려는 것이다.
type RemarkPlugins = NonNullable<Options['remarkPlugins']>;

const LINE_ANCHOR = /^L(\d+)$/;

// react-markdown의 기본 urlTransform은 모르는 스킴을 지운다. 판정은 classifyLink 하나로 모아야 하므로
// 주소를 그대로 받아서 이 파일이 직접 고른다(주입 위험은 링크를 "만들지 않는" 쪽으로 막는다).
const keepUrl = (url: string): string => url;

function ImageBlock({ src, alt, title }: { src: string; alt: string; title?: string }): React.ReactElement {
  const [broken, setBroken] = useState(false);
  const mode = imageMode(src);
  const label = alt === '' ? '그림' : alt;

  if (mode === 'inline' && !broken) {
    return (
      <span className="doc__scroll doc__img">
        <img src={src} alt={alt} title={title} onError={() => setBroken(true)} />
      </span>
    );
  }
  return (
    <span className="doc__img-fallback" title={title ?? src}>
      <span className="doc__img-alt">{label}</span>
      <span className="muted">이미지를 불러오지 못했습니다</span>
      {/* 원격 그림은 부르지 않는다(런타임에 외부 네트워크 없음). 대신 주소로 가는 길만 남긴다. */}
      {mode === 'badge-external' ? (
        <a href={src} target="_blank" rel="noopener noreferrer">
          원래 주소에서 보기 ↗
        </a>
      ) : null}
    </span>
  );
}

function DocLinkView({
  href,
  fromPath,
  sourcePaths,
  children,
}: {
  href: string;
  fromPath: string;
  sourcePaths: Map<string, string>;
  children: React.ReactNode;
}): React.ReactElement {
  const link = classifyLink(href, fromPath, sourcePaths);

  if (link.kind === 'internal') {
    const route = link.slug === undefined
      ? { kind: 'docs' as const, sourceId: link.source }
      : { kind: 'docs' as const, sourceId: link.source, slug: link.slug };
    return <a href={formatRoute(route)}>{children}</a>;
  }
  if (link.kind === 'same-doc') {
    return (
      <a
        href={`#${link.slug}`}
        onClick={(e) => {
          // 샌드박스 iframe에서는 네이티브 앵커 이동이 동작하지 않는다(F4).
          e.preventDefault();
          scrollToId(link.slug);
        }}
      >
        {children}
      </a>
    );
  }
  if (link.kind === 'external') {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
        <span className="muted" aria-hidden="true">
          ↗
        </span>
      </a>
    );
  }
  // 범위 밖·막힌 링크는 주소를 추측해 바꾸지 않는다. 글자만 남기고 이유를 붙인다.
  return (
    <span className="doc__dead" title={link.reason}>
      {children}
    </span>
  );
}

function CodeDoc({ body, highlight }: { body: string; highlight: number | null }): React.ReactElement {
  const lines = body.split('\n');
  return (
    <div className="doc__scroll doc__code">
      <table>
        <tbody>
          {lines.map((line, i) => {
            const no = i + 1;
            return (
              <tr key={no} id={`L${no}`} className={no === highlight ? 'doc__code-on' : undefined}>
                <td className="doc__code-no">{no}</td>
                <td className="doc__code-text">
                  <code>{line === '' ? '\u00a0' : line}</code>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DocReader({
  doc,
  sourcePaths,
  slug,
}: {
  doc: SourceDoc;
  sourcePaths: Map<string, string>;
  slug?: string;
}): React.ReactElement {
  const lineAnchor = slug === undefined ? null : LINE_ANCHOR.exec(slug);
  const highlight = lineAnchor === null ? null : Number(lineAnchor[1]);

  const components = useMemo<Components>(
    () => ({
      a: (props) =>
        props.href === undefined ? (
          <span className="doc__dead" title="주소가 없다">
            {props.children}
          </span>
        ) : (
          <DocLinkView href={props.href} fromPath={doc.path} sourcePaths={sourcePaths}>
            {props.children}
          </DocLinkView>
        ),
      img: (props) =>
        typeof props.src === 'string' ? (
          <ImageBlock src={props.src} alt={props.alt ?? ''} title={props.title} />
        ) : (
          <ImageBlock src="" alt={props.alt ?? ''} />
        ),
      // 넓은 표·코드는 가로 스크롤 상자에 넣는다. 본문 자체는 가로로 밀리지 않는다.
      table: (props) => (
        <div className="doc__scroll">
          <table>{props.children}</table>
        </div>
      ),
      pre: (props) => <pre className="doc__scroll">{props.children}</pre>,
    }),
    [doc.path, sourcePaths],
  );

  // 검사기가 쓴 헤딩 슬러그를 그대로 넘긴다 — 근거 참조가 가리키는 자리와 화면의 자리를 같게 만든다.
  const plugins = useMemo<RemarkPlugins>(
    () => [
      [remarkGfm, GFM_OPTIONS],
      remarkHtmlAsText,
      remarkWikilinks,
      [remarkHeadingIds, { headings: doc.headings }],
    ],
    [doc.headings],
  );

  // 절 이동은 렌더가 끝난 뒤에 한다. 없는 절이면 맨 위에 그대로 둔다.
  useEffect(() => {
    if (slug === undefined) {
      (scrollRoot() ?? window).scrollTo({ top: 0 });
      return;
    }
    const timer = window.setTimeout(() => scrollToId(slug), 60);
    return () => window.clearTimeout(timer);
  }, [doc.id, slug]);

  if (doc.missing) {
    return <div className="empty">원본 파일을 찾지 못했다. 경로가 바뀌었는지 확인한다.</div>;
  }

  if (!doc.embedded) {
    // 볼트 밖 저장소의 코드는 본문을 내장하지 않는다. 좌표만 보여 주고, url_base가 있을 때만 외부로 보낸다.
    return (
      <div className="doc__coord">
        <p>이 원본은 볼트 밖 저장소의 코드라 본문을 담지 않는다. 좌표만 남긴다.</p>
        <dl>
          <dt>저장소</dt>
          <dd>{doc.repo ?? '—'}</dd>
          <dt>경로</dt>
          <dd>{doc.path}</dd>
          <dt>기준 커밋</dt>
          <dd>{doc.commit ?? '—'}</dd>
        </dl>
        {doc.url_base ? (
          <a className="btn" href={`${doc.url_base}/${doc.path}`} target="_blank" rel="noopener noreferrer">
            저장소에서 열기 ↗
          </a>
        ) : (
          <p className="muted">외부 주소가 등록되지 않아 링크를 만들지 않는다.</p>
        )}
      </div>
    );
  }

  if (doc.kind === 'code' || doc.kind === 'data') {
    return <CodeDoc body={doc.body} highlight={highlight} />;
  }

  return (
    <div className="doc">
      <Markdown remarkPlugins={plugins} components={components} urlTransform={keepUrl}>
        {doc.body}
      </Markdown>
    </div>
  );
}
