import type { ReactNode } from 'react';

import { CopyPathButton } from './MetaPanel.tsx';
import { frameOrigin, frameUrl, rawHref } from './frame.ts';
import type { Source } from '../../shared/source.ts';

type Props = {
  path: string;
  hash: string;
  src: Source;
  /** /api/info 의 git 소스 출처 포트. 모르면 주 포트 + 1. */
  gitRawPort?: number | null;
  /** /api/info 의 주 포트. 개인 이름 뒤에서만 쓴다(frameOrigin). */
  rawPort?: number | null;
  /** 머리 막대 안쪽을 바꿔 끼운다(viewer.yml 보기). 받은 주소(새 탭 링크용)를 넘긴다. 없으면 경로·새 탭·복사다. */
  bar?: (href: string) => ReactNode;
  /** 기본 막대의 경로 뒤에 덧붙일 것(프로젝트 뷰어 산출물의 "통합 보기로 열기" 링크). */
  extra?: ReactNode;
};

/**
 * HTML·React 뷰어를 iframe 으로 보여 준다. 격리는 **출처 분리 + 호스트 분할**이다 — SPA 는
 * 127.0.0.1 에서만 뜨고(localhost 로 오면 302), iframe 의 src 는 localhost 출처다. 서버는 localhost
 * 호스트에서 `/raw` 만 내고 `/api` 는 404 라서, 산출물 스크립트는 자기 출처로도 다른 출처로도 `/api` 를
 * 읽지 못한다(다른 Origin 은 403, CORS 없음). `allow-same-origin` 을 주는 이유: 불투명 출처에서는
 * `history.pushState`·`localStorage` 가 SecurityError 를 던져 해시 라우팅 뷰어가 멈춘다(2026-10-23 실측,
 * 사용자 결정 A). git 소스(main·pr)의 html 은 또 다른 출처(`localhost:<git 포트>`)에서 연다 — 그 출처는
 * `/raw/@…` 만 내므로 PR 이 실어 온 스크립트가 디스크 /raw(private·워크트리)를 같은 출처로 읽지 못한다(판정 12).
 * 개인 이름 뒤에서는 localhost 로 건너뛰지 않는다(그 페이지의 localhost 하위 요청은 브라우저가 끊는다) — src 는 같은 호스트
 * `/raw/…` 이고, 서버가 `CSP: sandbox`(allow-same-origin 없음)로 내서 문서는 불투명 출처다. 이 틀은 안쪽 DOM 을 읽지 않으므로
 * (높이는 CSS 고정) 불투명 출처여도 바꿀 것이 없다.
 */
export function HtmlFrame({ path, hash, src: source, gitRawPort, rawPort, bar, extra }: Props) {
  const origin = frameOrigin(location.hostname, location.port, source, gitRawPort, rawPort);
  const src = frameUrl(origin, path, hash, source);
  return (
    <div className="html-frame-wrap">
      <div className="html-frame-bar">
        {bar !== undefined ? (
          bar(rawHref(origin, path, hash, source))
        ) : (
          <>
            <span className="html-frame-path">{path}</span>
            {extra}
            <a className="html-frame-open" href={rawHref(origin, path, hash, source)} target="_blank" rel="noreferrer">
              새 탭에서 열기
            </a>
            <CopyPathButton path={path} />
          </>
        )}
      </div>
      <iframe
        key={src}
        className="html-frame"
        sandbox="allow-scripts allow-same-origin allow-popups"
        referrerPolicy="no-referrer"
        src={src}
        title={path}
      />
    </div>
  );
}
