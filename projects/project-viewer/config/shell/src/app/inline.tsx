// 서술 문자열의 렌더러. dangerouslySetInnerHTML을 쓰지 않는다 — 토큰을 React 요소로만 만든다.
// 평문 조각 안의 참조 토큰(`D56`·`§ 7.9.2`)은 refs.ts 가 푼 대로 링크가 된다(코드 스팬 안은 건드리지 않는다).

import { createContext, Fragment, useContext, useState } from 'react';

import { cardPosition, inlinePieces } from './refs.ts';
import type { CardPos, RefPiece, RefResolver, RefTarget } from './refs.ts';

/** App 이 Bundle 로 만든 참조 해석기. 없으면(시험·단독 조각) 링크를 만들지 않는다. */
export const RefResolverContext = createContext<RefResolver | null>(null);

/** 참조 링크 하나. 마우스를 올리거나 초점이 오면 제목·상태·한 줄 요약 카드를 띄운다. */
function RefLink({ text, target }: { text: string; target: RefTarget }): React.ReactElement {
  const [pos, setPos] = useState<CardPos | null>(null);
  // 링크 자리를 재서 카드를 띄운다.
  const show = (e: React.SyntheticEvent<HTMLElement>) =>
    setPos(cardPosition(e.currentTarget.getBoundingClientRect(), window.innerWidth, window.innerHeight));
  // 카드를 닫는다.
  const hide = () => setPos(null);
  return (
    <a
      className="ref"
      data-ref={target.kind}
      href={target.href}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {text}
      {pos === null ? null : (
        <span className="ref__card" role="tooltip" aria-hidden="true" style={pos}>
          <span className="ref__title">{target.title}</span>
          {target.meta ? <span className="ref__meta">{target.meta}</span> : null}
          {target.summary ? <span className="ref__summary">{target.summary}</span> : null}
        </span>
      )}
    </a>
  );
}

/** 평문·링크 조각 목록을 그린다. */
function Pieces({ pieces }: { pieces: RefPiece[] }): React.ReactElement {
  return (
    <>
      {pieces.map((p, i) =>
        p.type === 'ref' ? <RefLink key={i} text={p.text} target={p.target} /> : <Fragment key={i}>{p.text}</Fragment>,
      )}
    </>
  );
}

/** refs=false: 이름표(제목·라벨)와 <button> 안의 글 — 단추 안에는 링크를 둘 수 없고, 누르면 열리는 근거 패널이 같은 글을 링크로 보여 준다. */
export function Inline({ text, refs = true }: { text: string; refs?: boolean }): React.ReactElement {
  const ctx = useContext(RefResolverContext);
  return (
    <>
      {inlinePieces(text, refs ? ctx : null).map((piece, i) => {
        if (piece.type === 'code') return <code key={i}>{piece.text}</code>;
        if (piece.type === 'strong')
          return (
            <strong key={i}>
              <Pieces pieces={piece.pieces} />
            </strong>
          );
        return <Pieces key={i} pieces={[piece]} />;
      })}
    </>
  );
}

// intro와 prose.text만 빈 줄로 문단을 나눌 수 있다(docs/schema.md § 공통 규칙).
export function InlineParagraphs({ text, className }: { text: string; className?: string }): React.ReactElement {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim() !== '');
  return (
    <div className={className}>
      {paragraphs.map((p, i) => (
        <p key={i}>
          <Inline text={p.replace(/\n/g, ' ')} />
        </p>
      ))}
    </div>
  );
}
