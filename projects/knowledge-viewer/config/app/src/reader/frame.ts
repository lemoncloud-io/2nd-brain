// HTML·React 뷰어를 iframe 으로 보여 줄 때 쓰는 순수 함수. DOM을 만지지 않는다.
import type { Route } from '../app/route.ts';
import type { Source } from '../../shared/source.ts';

export function isHtmlPath(path: string): boolean {
  return /\.html?$/i.test(path);
}

/** git 소스의 `/raw` 접두다. local 이거나 없으면 빈 문자열이다(서버 serveRaw 와 같은 문법). */
function rawPrefix(src?: Source): string {
  if (src === undefined || src.kind === 'local') return '';
  return src.kind === 'main' ? '@main/' : `@pr/${src.number}/`;
}

/**
 * `/raw/[@main/|@pr/<n>/]<경로>` + hash. hash 는 `#` 를 포함하거나 빈 문자열이다. 경로의 `#`·`?` 는 따로 부호화한다.
 * 경로 첫 글자 `@` 는 `%40` 으로 — 서버가 날 `@` 만 소스 접두로 읽으므로 `@…` 디스크 경로와 섞이지 않는다.
 */
export function frameSrc(path: string, hash: string, src?: Source): string {
  const enc = encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F').replace(/^@/, '%40');
  return '/raw/' + rawPrefix(src) + enc + hash;
}

/**
 * 새 탭·에이전트·본문 첨부용 주소. 출처를 붙인 절대 주소다(origin 은 같은 소스로 부른 frameOrigin 의 값).
 * html 이 SPA 출처(127.0.0.1)에서 열리지 않게 localhost 로 보낸다. 서버의 302 도 같은 곳이다:
 * 디스크 html 은 `127.0.0.1:<port>` → `localhost:<port>`, git 소스(`/raw/@…`) html·svg·xml 은
 * 두 호스트 모두 → `localhost:<git 포트>`(주 포트 + 1 또는 --git-port).
 */
export function rawHref(origin: string, path: string, hash: string, src?: Source): string {
  return frameUrl(origin, path, hash, src);
}

/** 에이전트 모드에서는 iframe 안을 읽을 수 없으므로 원본 주소로 건너뛴다. */
export function shouldHopToRaw(route: Route): boolean {
  return route.agent && isHtmlPath(route.path);
}

/**
 * git 소스(@main·@pr) /raw 의 출처: `http://localhost:<git 포트>`. git 포트는 /api/info 의 gitRawPort,
 * 모르면(아직 안 받음·옛 서버) 주 포트 + 1 이다. 이 출처는 `/raw/@…` 만 내므로 PR html 이 디스크 /raw
 * (private·워크트리 수정)를 같은 출처로 읽지 못한다.
 */
export function gitRawOrigin(port: string, gitRawPort?: number | null): string {
  const valid = typeof gitRawPort === 'number' && Number.isInteger(gitRawPort) && gitRawPort > 0 && gitRawPort <= 65535;
  const p = valid ? gitRawPort : (port === '' ? 80 : Number(port)) + 1;
  return `http://localhost:${p}`;
}

/**
 * iframe·원본 링크의 출처. 앱(127.0.0.1)과 다른 출처 localhost 로 연다(서버는 localhost 에서 /raw 만 준다).
 * local(디스크)은 같은 포트, main·pr 은 git 포트(gitRawOrigin)다.
 */
export function frameOrigin(_hostname: string, port: string, src?: Source, gitRawPort?: number | null): string {
  if (src !== undefined && src.kind !== 'local') return gitRawOrigin(port, gitRawPort);
  return `http://localhost:${port}`;
}

/** 출처를 붙인 iframe 주소다. */
export function frameUrl(origin: string, path: string, hash: string, src?: Source): string {
  return origin + frameSrc(path, hash, src);
}
