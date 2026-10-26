import { CopyPathButton } from './MetaPanel.tsx';
import { frameOrigin, frameUrl, rawHref } from './frame.ts';
import type { Source } from '../../shared/source.ts';

type Props = {
  path: string;
  hash: string;
  src: Source;
  /** /api/info 의 git 소스 출처 포트. 모르면 주 포트 + 1. */
  gitRawPort?: number | null;
};

/**
 * HTML·React 뷰어를 iframe 으로 보여 준다. 격리는 **출처 분리 + 호스트 분할**이다 — SPA 는
 * 127.0.0.1 에서만 뜨고(localhost 로 오면 302), iframe 의 src 는 localhost 출처다. 서버는 localhost
 * 호스트에서 `/raw` 만 내고 `/api` 는 404 라서, 산출물 스크립트는 자기 출처로도 다른 출처로도 `/api` 를
 * 읽지 못한다(다른 Origin 은 403, CORS 없음). `allow-same-origin` 을 주는 이유: 불투명 출처에서는
 * `history.pushState`·`localStorage` 가 SecurityError 를 던져 해시 라우팅 뷰어가 멈춘다(2026-10-23 실측,
 * 사용자 결정 A). git 소스(main·pr)의 html 은 또 다른 출처(`localhost:<git 포트>`)에서 연다 — 그 출처는
 * `/raw/@…` 만 내므로 PR 이 실어 온 스크립트가 디스크 /raw(private·워크트리)를 같은 출처로 읽지 못한다(판정 12).
 */
export function HtmlFrame({ path, hash, src: source, gitRawPort }: Props) {
  const origin = frameOrigin(location.hostname, location.port, source, gitRawPort);
  const src = frameUrl(origin, path, hash, source);
  return (
    <div className="html-frame-wrap">
      <div className="html-frame-bar">
        <span className="html-frame-path">{path}</span>
        <a className="html-frame-open" href={rawHref(origin, path, hash, source)} target="_blank" rel="noreferrer">
          새 탭에서 열기
        </a>
        <CopyPathButton path={path} />
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
