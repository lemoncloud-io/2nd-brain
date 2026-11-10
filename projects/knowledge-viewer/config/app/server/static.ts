// /raw/<rel>(볼트 파일 그대로, @main·@pr/<n> 접두면 그 소스)와 /·/v/*(빌드된 화면)을 흘려 보낸다.
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream';
import type http from 'node:http';

import { wantsArchifyFit } from '../shared/archify-fit.ts';
import { segmentsBlocked } from '../shared/scope.ts';
import { MAIN, sourceKey } from '../shared/source.ts';
import type { Source } from '../shared/source.ts';
import { fitRawBytes } from './archify-fit.ts';
import { isFileInside, resolveDiskPath } from './handlers.ts';
import type { Ctx } from './handlers.ts';

/** git 소스는 private 를 담지 않는다 — 경로 검사도 그렇게 한다(handlers.ts 의 GIT_SCOPE 와 같다). */
const GIT_SCOPE = { includePrivate: false };

const TYPES: Record<string, string> = {
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  yml: 'text/yaml; charset=utf-8',
  yaml: 'text/yaml; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

export function contentType(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase();
  return TYPES[ext] ?? 'application/octet-stream';
}

function sendText(res: http.ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function stream(req: http.IncomingMessage, res: http.ServerResponse, abs: string, headers: Record<string, string>): void {
  let size: number;
  try {
    size = fs.statSync(abs).size;
  } catch {
    sendText(res, 404, '파일이 없다');
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': String(size) });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  // pipeline은 클라이언트가 끊으면(res 닫힘) 읽기 스트림을 닫아 fd가 새지 않게 한다.
  pipeline(fs.createReadStream(abs), res, () => {});
}

/** git 소스 접두: `/raw/@main/<rel>`·`/raw/@pr/<n>/<rel>`. 부호화 전 문자열에 맞춘다. */
const GIT_RAW = /^@(?:main|pr\/(\d{1,9}))\/(.*)$/s;

/**
 * /raw/<rel>(디스크), /raw/@main/<rel>(origin/master), /raw/@pr/<n>/<rel>(PR 머리).
 * pathname은 인코딩된 그대로 받는다. 접두는 날 `@` 일 때만 소스다 — `%40` 으로 시작하면 디스크의 `@…` 경로다.
 * 그 밖의 `/raw/@…` 는 404 다. 폴더 목록은 내지 않는다.
 * search(`?…`)에 `kv-fit=1` 이 있고 html 이면 archify 틀 맞춤 조각을 넣어 낸다(archify-fit.ts). 그 밖은 바이트 그대로다.
 * extra 는 응답 머리에 더한다(개인 이름 뒤 능동 콘텐츠의 RAW_SANDBOX_HEADERS). 오류 응답(404·503)에는 붙이지 않는다.
 */
export async function serveRaw(
  ctx: Ctx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  search = '',
  extra: Readonly<Record<string, string>> = {},
): Promise<void> {
  const encoded = pathname.slice('/raw/'.length);
  if (encoded.startsWith('@')) {
    const m = GIT_RAW.exec(encoded);
    let rel: string | null = null;
    if (m !== null) {
      try {
        rel = decodeURIComponent(m[2] ?? '');
      } catch {
        rel = null;
      }
    }
    if (m === null || rel === null) {
      sendText(res, 404, '없는 소스이거나 잘못된 경로다');
      return;
    }
    const src: Source = m[1] === undefined ? MAIN : { kind: 'pr', number: Number(m[1]) };
    await serveGitRaw(ctx, req, res, src, rel, search, extra);
    return;
  }
  let rel: string;
  try {
    rel = decodeURIComponent(encoded);
  } catch {
    sendText(res, 404, '잘못된 경로다');
    return;
  }
  const abs = resolveDiskPath(ctx, rel);
  if (abs === null || !isFileInside(ctx.root, abs)) {
    sendText(res, 404, `파일이 없다: ${rel}`);
    return;
  }
  const headers = { 'Content-Type': contentType(abs), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', ...extra };
  // 맞춤 주입이면 파일을 읽어 고친 바이트를 낸다. 아니면 지금처럼 흘려 보낸다(읽지 않는다).
  const fitted = /\.html?$/i.test(abs) && wantsArchifyFit(search) ? readFitted(abs, rel, search) : null;
  if (fitted !== null) {
    sendBytes(req, res, fitted, headers);
    return;
  }
  stream(req, res, abs, headers);
}

/** 디스크 html 을 읽어 맞춤 조각을 넣는다. 맞춤이 아니거나 못 읽으면 null(흘려 보내기로 돌아간다). */
function readFitted(abs: string, rel: string, search: string): Buffer | null {
  try {
    return fitRawBytes(rel, search, fs.readFileSync(abs));
  } catch {
    return null;
  }
}

/** 메모리 바이트를 길이와 함께 낸다. HEAD 면 머리만. */
function sendBytes(req: http.IncomingMessage, res: http.ServerResponse, bytes: Buffer, headers: Record<string, string>): void {
  res.writeHead(200, { ...headers, 'Content-Length': String(bytes.length) });
  res.end(req.method === 'HEAD' ? undefined : bytes);
}

/** git 소스의 파일 하나. 경로 검사를 먼저 해서, 거부할 경로는 소스를 열지 않는다(fetch·gh 없음). */
async function serveGitRaw(
  ctx: Ctx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  src: Source,
  rel: string,
  search: string,
  extra: Readonly<Record<string, string>>,
): Promise<void> {
  if (segmentsBlocked(rel.split('/'), GIT_SCOPE)) {
    sendText(res, 404, `열 수 없는 경로다: ${rel}`);
    return;
  }
  const reader = await ctx.sources.reader(src, false);
  if ('error' in reader) {
    sendText(res, 503, `${sourceKey(src)} 를 열지 못했다: ${reader.error}`);
    return;
  }
  const bytes = reader.readBytes(rel);
  if (bytes === null) {
    sendText(res, 404, `파일이 없다: ${rel}`);
    return;
  }
  // 맞춤 주입(html + kv-fit=1)이면 고친 바이트, 아니면 그대로다.
  const out = fitRawBytes(rel, search, bytes) ?? bytes;
  sendBytes(req, res, out, { 'Content-Type': contentType(rel), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', ...extra });
}

/**
 * `/`·`/v/*`·`/apps/*`은 빌드된 index.html이다. 없으면 503이다.
 * app 을 주면(`/apps/<id>` 화면) 앱 보안 헤더를 붙이고, appToken 이 있으면 그 meta 를 넣어 낸다 — 캐시하지 않는다.
 * 주지 않으면 파일 바이트 그대로, 헤더도 지금 그대로다.
 */
export function serveIndexHtml(distDir: string, req: http.IncomingMessage, res: http.ServerResponse, app?: { appToken: string | null }): void {
  const file = path.join(distDir, 'index.html');
  if (!fs.existsSync(file)) {
    sendText(res, 503, '빌드 전 — npm run build');
    return;
  }
  if (app === undefined) {
    stream(req, res, file, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return;
  }
  let html: string;
  try {
    html = fs.readFileSync(file, 'utf8');
  } catch {
    sendText(res, 404, '파일이 없다');
    return;
  }
  // 등록되지 않은 id 는 토큰 없이 화면만("앱 없음"). 헤더는 같다.
  const body = app.appToken === null ? html : withAppToken(html, app.appToken);
  sendBytes(req, res, Buffer.from(body), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...APP_PAGE_HEADERS });
}

/**
 * 개인 이름 뒤에서 같은 호스트로 내는 /raw 능동 콘텐츠(html·svg·xml)의 격리 머리. `allow-same-origin` 이 없어
 * 임베더의 iframe 속성과 무관하게 문서가 불투명 출처가 된다 — 그 스크립트의 /api 요청은 `Origin: null` 로 403,
 * 디스크 /raw fetch 는 CORS 가 없어 읽지 못한다(판정 12 의 목적을 출처 분리 대신 이 머리로 지킨다).
 */
export const RAW_SANDBOX_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Security-Policy': 'sandbox allow-scripts allow-popups allow-forms',
});

/** `/apps/<id>` 응답의 보안 헤더. 단독 워크벤치와 같은 값이다(설계 결정 4). 뷰어의 다른 경로에는 붙이지 않는다. */
export const APP_PAGE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
});

/** 앱 토큰 meta 이름. 화면(src/apps/token.ts)이 이 이름으로 읽는다. */
export const APP_TOKEN_META = 'kv-app-token';

/** index.html 에 앱 토큰 meta 를 넣는다 — `</head>` 앞, 없으면 맨 앞. 토큰은 hex 라 따로 이스케이프할 것이 없다. */
export function withAppToken(html: string, token: string): string {
  const meta = `<meta name="${APP_TOKEN_META}" content="${token.replace(/[^0-9a-f]/gi, '')}" />`;
  const at = html.indexOf('</head>');
  return at === -1 ? meta + html : html.slice(0, at) + meta + html.slice(at);
}

/** `/assets/*` 같은 빌드 산출물이다. distDir 밖으로는 나가지 않는다. */
export function serveDist(distDir: string, req: http.IncomingMessage, res: http.ServerResponse, pathname: string): void {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname.slice(1));
  } catch {
    sendText(res, 404, '잘못된 경로다');
    return;
  }
  const segs = rel.split('/');
  const abs = path.join(distDir, rel);
  if (segs.some((s) => s === '' || s === '.' || s === '..') || !isFileInside(distDir, abs)) {
    sendText(res, 404, '파일이 없다');
    return;
  }
  stream(req, res, abs, { 'Content-Type': contentType(abs), 'Cache-Control': 'no-cache' });
}
