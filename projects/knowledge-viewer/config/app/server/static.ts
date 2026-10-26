// /raw/<rel>(볼트 파일 그대로, @main·@pr/<n> 접두면 그 소스)와 /·/v/*(빌드된 화면)을 흘려 보낸다.
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream';
import type http from 'node:http';

import { segmentsBlocked } from '../shared/scope.ts';
import { MAIN, sourceKey } from '../shared/source.ts';
import type { Source } from '../shared/source.ts';
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
 */
export async function serveRaw(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
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
    await serveGitRaw(ctx, req, res, src, rel);
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
  stream(req, res, abs, {
    'Content-Type': contentType(abs),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
  });
}

/** git 소스의 파일 하나. 경로 검사를 먼저 해서, 거부할 경로는 소스를 열지 않는다(fetch·gh 없음). */
async function serveGitRaw(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, src: Source, rel: string): Promise<void> {
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
  res.writeHead(200, {
    'Content-Type': contentType(rel),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
    'Content-Length': String(bytes.length),
  });
  res.end(req.method === 'HEAD' ? undefined : bytes);
}

/** `/`·`/v/*`은 빌드된 index.html이다. 없으면 503이다. */
export function serveIndexHtml(distDir: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const file = path.join(distDir, 'index.html');
  if (!fs.existsSync(file)) {
    sendText(res, 503, '빌드 전 — npm run build');
    return;
  }
  stream(req, res, file, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
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
