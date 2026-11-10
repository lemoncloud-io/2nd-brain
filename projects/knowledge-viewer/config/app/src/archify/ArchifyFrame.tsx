// archify 산출 HTML 하나를 html 틀과 같은 샌드박스 iframe 으로 여는 틀. 테마(?theme=)·높이 맞춤(kv-fit)·⚙ 그림 글자 배율을 맡는다.
// 어느 산출을 열지(등록부 조회·안내 문구)는 확장 화면이 정해 path·label·hash 로 넘긴다.
import { useRef, useSyncExternalStore } from 'react';

import { withFitParam } from '../../shared/archify-fit.ts';
import type { Source } from '../../shared/source.ts';
import { resolveDark } from '../app/themes.ts';
import { frameOrigin, frameUrl } from '../reader/frame.ts';
import type { FramePorts } from '../ext/define.ts';
import { useArchifyZoom } from './archify-zoom.ts';
import { useArchifyFit } from './useArchifyFit.ts';

// 뷰어 밝기(<html data-scheme> 또는 OS 설정)를 archify 의 ?theme= 값으로 읽는다.
function schemeNow(): 'light' | 'dark' {
  const os = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  return resolveDark(document.documentElement.dataset['scheme'], os) ? 'dark' : 'light';
}

// 밝기 선택(<html> 속성)과 OS 설정 변화를 듣는다.
function subscribeScheme(fn: () => void): () => void {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', fn);
  const mo = new MutationObserver(fn);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-scheme'] });
  return () => { mq.removeEventListener('change', fn); mo.disconnect(); };
}

/** 틀이 받는 것: 볼트 경로·제목·archify 해시(`#…` 또는 빈 값)와 소스·에이전트 모드·/raw 포트. */
export type ArchifyFrameProps = { path: string; label: string; hash: string; src: Source; agent: boolean; frame: FramePorts };

/**
 * archify 산출 하나를 연다. iframe 은 `kv-fit=1` 로 열어 서버가 넣은 스크립트가 내용 높이를 알리게 한다 —
 * 틀 높이를 내용에 맞춰 안쪽 세로 스크롤을 없앤다. ⚙ 의 "그림 글자" 배율은 다시 열지 않고 메시지로 보낸다.
 */
export function ArchifyFrame({ path, label, hash, src, agent, frame }: ArchifyFrameProps) {
  const theme = useSyncExternalStore(subscribeScheme, schemeNow, () => 'light' as const);
  const zoom = useArchifyZoom();
  const frameRef = useRef<HTMLIFrameElement>(null);
  // git 소스·개인 이름 뒤에서는 /api/info 의 포트를 안 뒤에 연다(html 틀과 같은 규칙).
  const openable = frame.ready;
  const origin = openable ? frameOrigin(location.hostname, location.port, src, frame.gitRawPort, frame.rawPort) : '';
  // 테마는 쿼리로 넘긴다(archify 가 ?theme=light|dark 를 읽는다). 바뀌면 key 로 다시 연다.
  const url = openable ? frameUrl(origin, path, '', src) + `?theme=${theme}` + hash : null;
  // 틀에는 맞춤 표지를 더한 주소를 쓴다. 새 탭·에이전트 주소에는 붙이지 않는다.
  const fitUrl = url !== null && !agent ? withFitParam(url) : null;
  const height = useArchifyFit(frameRef, fitUrl, zoom);
  if (!frame.ready || url === null) return <p className="notice">불러오는 중…</p>;
  // 에이전트 모드는 iframe 안을 읽지 못하므로 원본 주소 한 줄만 보인다.
  if (agent) {
    const raw = frameUrl(origin, path, hash, src);
    return <p className="archify-raw">{label} 원본(archify): <a href={raw} data-vault-path={path}>{raw}</a></p>;
  }
  // 높이를 알기 전에는 CSS 기본 높이(안쪽 스크롤)다. 알리면 그 높이로 맞춘다.
  return <div className="archify-frame-wrap">
    <iframe ref={frameRef} key={fitUrl ?? url} className="archify-frame" sandbox="allow-scripts allow-same-origin allow-popups"
      referrerPolicy="no-referrer" src={fitUrl ?? url} title={`${label} — archify`}
      data-fit={height === null ? undefined : 'measured'} style={height === null ? undefined : { height: `${height}px` }} />
    <p className="hint"><a href={url} target="_blank" rel="noreferrer">새 탭에서 열기</a></p>
  </div>;
}
