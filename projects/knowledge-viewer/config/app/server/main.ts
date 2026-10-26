// 서버 진입점. createViewerServer는 listen하지 않는다(호출자가 한다). CLI는 이 파일을 직접 실행할 때만 돈다.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findVaultRoot } from '../shared/vault.ts';
import { DEFAULT_EMBED_MODEL, DEFAULT_OLLAMA_URL, EmbeddingService, assertLoopbackUrl } from './embeddings.ts';
import { EMBED_BUILD_PATH, handleApi } from './handlers.ts';
import type { Ctx } from './handlers.ts';
import { VaultIndex } from './index-store.ts';
import { SourceManager } from './source.ts';
import { PrSource, parseRepos, spawnGh, type GhRunner } from './panels/prs.ts';
import { handlePanels } from './panels/routes.ts';
import { ViewersSource } from './panels/viewers.ts';
import { CACHE_PATH, isUsable, readCacheResult } from './link-cache.ts';
import { startWatch } from './watch.ts';
import { serveDist, serveIndexHtml, serveRaw } from './static.ts';

export type ViewerOptions = {
  root: string;
  includePrivate: boolean;
  distDir: string;
  index?: VaultIndex;
  watch?: boolean;
  /** PR 패널이 보는 레포 허용 목록(owner/name). 비면 볼트 레포 하나. */
  prRepos?: string[];
  /** 그래프 허브 문턱(`in + out` 초과면 허브). 기본 50. */
  graphHub?: number;
  /** gh 러너. 시험이 스텁을 준다. */
  gh?: GhRunner;
  /** 문서 소스(main·local·pr). 시험이 주입한다. 기본은 root·gh 로 만든다. */
  sources?: SourceManager;
  /** 시작 로그 한 줄씩. 기본 console.log. */
  log?: (line: string) => void;
  /** git 소스 출처 포트. gitServer 가 listen 하기 전 302·/api/info 가 쓴다. 없으면 주 포트 + 1. */
  gitPort?: number;
  /**
   * 임베딩 묶음. false 면 끈다(/api/info 의 available: false). 주지 않으면 기본 Ollama(127.0.0.1:11434)·EmbeddingGemma 2(270M 텍스트) 로 켜 둔다 —
   * 켜 두어도 사용자가 화면에서 켜기 전에는 Ollama 를 부르지 않는다.
   */
  embeddings?: false | { ollamaUrl?: string; model?: string; cacheDir?: string };
};

/**
 * 주 서버(SPA·/api·디스크 /raw)와 git 소스 출처 서버(gitServer: `/raw/@main/…`·`/raw/@pr/<n>/…` 만).
 * 둘 다 listen 은 호출자가 한다(listenViewer). 주 서버를 닫으면 gitServer 도 닫는다.
 */
export type ViewerServer = http.Server & { gitServer: http.Server };

const PING_MS = 30_000;
/** 브라우저가 문서로 그려 스크립트를 돌릴 수 있는 확장자다. */
const ACTIVE_RAW = /\.(html?|xhtml|svg|xml)$/i;
/** git 소스 접두(날 `@`). `%40…` 은 디스크 경로다(static.ts 의 serveRaw 와 같은 문법). */
const isGitRawPath = (p: string): boolean => p.startsWith('/raw/@');

const notFound = (req: http.IncomingMessage, res: http.ServerResponse): void => {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(req.method === 'HEAD' ? undefined : '없는 주소다');
};

/** serveRaw 의 비동기 실패를 500 으로 끝낸다 — 처리되지 않은 거부로 프로세스가 죽지 않게. */
function serveRawSafely(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, p: string): void {
  serveRaw(ctx, req, res, p).catch((e: unknown) => {
    console.error(e);
    try {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('내부 오류');
      } else res.destroy();
    } catch {
      res.destroy();
    }
  });
}

const portOfServer = (s: http.Server): number | null => {
  const a = s.address();
  return typeof a === 'object' && a !== null ? a.port : null;
};

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function hostnameOf(host: string): string {
  try {
    return new URL('http://' + host).hostname;
  } catch {
    return '';
  }
}

function portOf(host: string): string {
  try {
    return new URL('http://' + host).port;
  } catch {
    return '';
  }
}

export function createViewerServer(opts: ViewerOptions): ViewerServer {
  const log = opts.log ?? console.log;
  let index = opts.index;
  if (!index) {
    // docs/link-graph.yml 이 있으면 해시가 같은 문서는 파싱하지 않는다. 뷰어는 캐시를 읽기만 한다(쓰는 것은 link-cache.ts).
    const read = readCacheResult(opts.root);
    const cache = read.cache;
    const usable = isUsable(cache);
    if (read.status === 'unreadable') log(`${CACHE_PATH} 을 읽지 못했다 — 전부 파싱한다. link-cache.ts build 로 다시 만든다`);
    else if (cache !== null && !usable) log(`${CACHE_PATH} 을 쓰지 않는다 — schema·parser 불일치, 전부 파싱한다`);
    index = new VaultIndex(opts.root);
    const s = index.build({ cache: usable ? cache : undefined });
    log(`색인 ${s.files} 문서 (캐시 ${s.cached} · 파싱 ${s.parsed}) ${(s.ms / 1000).toFixed(1)}s`);
  }
  const sources = opts.sources ?? new SourceManager(opts.root, { gh: opts.gh });
  // git 출처 서버는 아래에서 만든다. 포트는 listen 뒤 실제 값, 그 전엔 opts.gitPort, 그것도 없으면 주 포트 + 1.
  let gitServer: http.Server | null = null;
  let mainServer: http.Server | null = null;
  const gitRawPort = (): number | null => {
    const live = gitServer === null ? null : portOfServer(gitServer);
    if (live !== null) return live;
    if (opts.gitPort !== undefined && opts.gitPort > 0) return opts.gitPort;
    const main = mainServer === null ? null : portOfServer(mainServer);
    return main === null ? null : main + 1;
  };
  const ctx: Ctx = {
    root: opts.root,
    includePrivate: opts.includePrivate,
    index,
    titleCache: new Map(),
    sources,
    gitRawPort,
    graphHub: opts.graphHub ?? 50,
    ...(opts.embeddings === false ? {} : { embeddings: new EmbeddingService({ root: opts.root, index, log, ...opts.embeddings }) }),
  };
  const prSource = new PrSource({ root: opts.root, includePrivate: opts.includePrivate, repos: opts.prRepos ?? [], gh: opts.gh ?? spawnGh });
  const viewersSource = new ViewersSource({ root: opts.root, includePrivate: opts.includePrivate });

  // SSE 클라이언트. 변경이 생기면 모두에게 알린다.
  const clients = new Set<http.ServerResponse>();
  const broadcast = (p: string): void => {
    if (/[\r\n]/.test(p)) return;
    for (const c of clients) c.write(`event: changed\ndata: ${p}\n\n`);
  };
  const stopWatch = opts.watch === false ? () => {} : startWatch(opts.root, index, broadcast, { includePrivate: opts.includePrivate });
  const pinger = setInterval(() => {
    for (const c of clients) c.write(': ping\n\n');
  }, PING_MS);
  pinger.unref();

  const server = http.createServer((req, res) => {
    try {
      // POST 는 임베딩 색인 시작 하나만 받는다(아래 Origin 검사를 그대로 지난다).
      const postOk = req.method === 'POST' && (req.url ?? '').split('?')[0] === EMBED_BUILD_PATH;
      if (req.method !== 'GET' && req.method !== 'HEAD' && !postOk) {
        const isApi = (req.url ?? '').startsWith('/api/');
        res.writeHead(405, {
          Allow: 'GET, HEAD',
          'Content-Type': isApi ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
        });
        res.end(isApi ? JSON.stringify({ error: 'GET만 받는다' }) : 'GET만 받는다');
        return;
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const p = url.pathname;
      // 호스트 분할: SPA·/api 는 127.0.0.1 만, 다른 루프백 호스트(localhost)는 /raw 만 받는다.
      // iframe 은 localhost 로 열리므로 같은 출처 fetch 로도 /api 를 읽지 못한다.
      const host = req.headers.host ?? '';
      const hostname = hostnameOf(host);
      if (p.startsWith('/raw/')) {
        // /raw 는 루프백 이름 둘만 받는다(DNS 리바인딩으로 다른 이름이 오면 404).
        if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
          notFound(req, res);
          return;
        }
        if (ACTIVE_RAW.test(safeDecode(p))) {
          // git 소스의 능동 콘텐츠는 git 포트 출처로만 낸다 — 디스크 /raw(private·워크트리)와 같은 출처에 서지 않게.
          if (isGitRawPath(p)) {
            res.writeHead(302, { Location: `http://localhost:${gitRawPort() ?? Number(portOf(host) || 80) + 1}${p}${url.search}` });
            res.end();
            return;
          }
          // 디스크의 능동 콘텐츠는 SPA 출처(127.0.0.1)에서 그리지 않는다 — 같은 포트 localhost 로 보낸다.
          if (hostname === '127.0.0.1') {
            const port = portOf(host);
            res.writeHead(302, { Location: `http://localhost${port === '' ? '' : `:${port}`}${p}${url.search}` });
            res.end();
            return;
          }
        }
        // git 소스의 비능동 파일(md·png·pdf …)은 스크립트를 돌리지 못하므로 여기서 그대로 낸다.
        serveRawSafely(ctx, req, res, p);
        return;
      }
      if (hostname !== '127.0.0.1') {
        if (p.startsWith('/api/')) {
          const text = JSON.stringify({ error: 'not found' });
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(Buffer.byteLength(text)) });
          res.end(req.method === 'HEAD' ? undefined : text);
          return;
        }
        if (p === '/' || p === '/v' || p.startsWith('/v/') || p.startsWith('/assets/')) {
          const port = portOf(host);
          res.writeHead(302, { Location: `http://127.0.0.1${port === '' ? '' : `:${port}`}${req.url ?? '/'}` });
          res.end();
          return;
        }
      }
      if (p.startsWith('/api/')) {
        // 다른 출처가 /api 를 읽지 못하게 한다. Origin 이 없으면 같은 출처 탐색으로 본다.
        const origin = req.headers.origin;
        const crossOrigin = origin !== undefined && origin !== `http://${req.headers.host ?? ''}`;
        if (!crossOrigin && p === '/api/events' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          res.write(': connected\n\n');
          clients.add(res);
          res.on('close', () => clients.delete(res));
          return;
        }
        // 직렬화가 실패하면(순환 객체 — yaml 별칭 등) 500 으로 답한다. 문서 내용이 서버를 넘어뜨리지 못하게 한다.
        const writeJson = ({ status: wanted, body }: { status: number; body: unknown }): void => {
          let status = wanted;
          let text: string;
          try {
            text = JSON.stringify(body);
          } catch (e) {
            console.error(e);
            status = 500;
            text = JSON.stringify({ error: '내부 오류' });
          }
          res.writeHead(status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': String(Buffer.byteLength(text)),
            'Cache-Control': 'no-cache',
          });
          res.end(req.method === 'HEAD' ? undefined : text);
        };
        if (crossOrigin) {
          writeJson({ status: 403, body: { error: 'cross-origin' } });
          return;
        }
        // 패널(gh)·소스(fetch·gh)가 비동기다. 호스트·Origin 검사는 위에서 이미 지났다.
        const pending = p.startsWith('/api/panels/') ? handlePanels(prSource, url, viewersSource) : handleApi(ctx, url, req.method);
        // 핸들러 실패도, 응답 쓰기 실패도 여기서 끝낸다 — 처리되지 않은 거부로 프로세스가 죽지 않게.
        pending.then(writeJson).catch((e: unknown) => {
          console.error(e);
          try {
            if (!res.headersSent) writeJson({ status: 500, body: { error: '내부 오류' } });
            else res.destroy();
          } catch {
            res.destroy();
          }
        });
      } else if (p === '/' || p === '/v' || p.startsWith('/v/')) {
        serveIndexHtml(opts.distDir, req, res);
      } else if (p.startsWith('/assets/')) {
        serveDist(opts.distDir, req, res, p);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('없는 주소다');
      }
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '내부 오류' }));
    }
  });
  mainServer = server;

  // git 소스 출처: `/raw/@main/…`·`/raw/@pr/<n>/…` 만 낸다. 그 밖(디스크 /raw·/api·SPA)은 404, CORS 없음.
  // PR 이 실어 온 html 은 여기서 뜬다 — 디스크 /raw(주 포트 localhost)를 같은 출처로 읽지 못한다.
  const git = http.createServer((req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('GET만 받는다');
        return;
      }
      const p = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      const hostname = hostnameOf(req.headers.host ?? '');
      if ((hostname !== 'localhost' && hostname !== '127.0.0.1') || !isGitRawPath(p)) {
        notFound(req, res);
        return;
      }
      serveRawSafely(ctx, req, res, p);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('내부 오류');
    }
  });
  gitServer = git;

  // close 는 열린 연결이 끝나야 콜백을 부른다. SSE 는 스스로 끝나지 않으므로 먼저 끊는다.
  const endClients = (): void => {
    for (const c of clients) c.end();
    clients.clear();
  };
  const close = server.close.bind(server);
  server.close = ((cb?: (err?: Error) => void) => {
    endClients();
    if (git.listening) {
      git.close();
      git.closeAllConnections();
    }
    return close(cb);
  }) as typeof server.close;
  server.on('close', () => {
    stopWatch();
    clearInterval(pinger);
    endClients();
    if (git.listening) git.close();
  });
  return Object.assign(server, { gitServer: git });
}

function listenOn(s: http.Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (e: Error): void => reject(e);
    s.once('error', onError);
    s.listen(port, host, () => {
      s.off('error', onError);
      resolve(portOfServer(s) ?? port);
    });
  });
}

/**
 * 주 포트와 git 소스 포트를 127.0.0.1 에 연다. git 포트를 못 열면 주 포트도 닫고 거부한다 —
 * git 소스 능동 콘텐츠를 같은 출처로 물려 내지 않는다. gitPort 를 빼면 주 포트 + 1(주 포트가 0 이면 0).
 */
export async function listenViewer(server: ViewerServer, port: number, gitPort?: number, host = '127.0.0.1'): Promise<{ port: number; gitPort: number }> {
  const main = await listenOn(server, port, host);
  const want = gitPort ?? (port === 0 ? 0 : main + 1);
  try {
    const g = await listenOn(server.gitServer, want, host);
    return { port: main, gitPort: g };
  } catch (e) {
    await new Promise<void>((r) => server.close(() => r()));
    const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : e instanceof Error ? e.message : String(e);
    throw new Error(
      `git 소스 포트 ${want} 를 열지 못했다(${code}). git 소스(@main·@pr) html 은 별도 출처가 있어야 한다 — --git-port <n> 또는 KNOWLEDGE_VIEWER_GIT_PORT 로 빈 포트를 준다`,
    );
  }
}

export function parseArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): {
  vault?: string;
  port: number;
  gitPort?: number;
  includePrivate: boolean;
  prRepos: string[];
  graphHub?: number;
  embed: boolean;
  ollamaUrl: string;
  embedModel: string;
} {
  let vault: string | undefined;
  let port = Number(env.KNOWLEDGE_VIEWER_PORT ?? 8778);
  // git 소스 출처 포트. 없으면 시작 때 주 포트 + 1.
  let gitPort: number | undefined = env.KNOWLEDGE_VIEWER_GIT_PORT === undefined || env.KNOWLEDGE_VIEWER_GIT_PORT === '' ? undefined : Number(env.KNOWLEDGE_VIEWER_GIT_PORT);
  // private/ 는 로컬에서 돌릴 때 기본으로 보인다(사용자 결정 2026-10-23). 숨기려면 --hide-private
  // 또는 KNOWLEDGE_VIEWER_HIDE_PRIVATE=1. --include-private 는 호환용으로 남긴다.
  let includePrivate = !(env.KNOWLEDGE_VIEWER_HIDE_PRIVATE === '1' || env.KNOWLEDGE_VIEWER_HIDE_PRIVATE === 'true');
  let graphHub: number | undefined;
  // 임베딩 묶음: Ollama 주소·모델. CLI 가 환경 변수(KV_OLLAMA_URL·KV_EMBED_MODEL)를 이긴다. --no-embed 면 끈다.
  let embed = true;
  let ollamaUrl = env.KV_OLLAMA_URL || DEFAULT_OLLAMA_URL;
  let embedModel = env.KV_EMBED_MODEL || DEFAULT_EMBED_MODEL;
  const cliRepos: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--vault') vault = argv[(i += 1)];
    else if (a === '--port') port = Number(argv[(i += 1)]);
    else if (a === '--git-port') gitPort = Number(argv[(i += 1)]);
    else if (a === '--include-private') includePrivate = true;
    else if (a === '--hide-private') includePrivate = false;
    else if (a === '--graph-hub') graphHub = Number(argv[(i += 1)]);
    else if (a === '--pr-repo') cliRepos.push(argv[(i += 1)] ?? '');
    else if (a === '--ollama-url') ollamaUrl = argv[(i += 1)] ?? '';
    else if (a === '--embed-model') embedModel = argv[(i += 1)] ?? '';
    else if (a === '--no-embed') embed = false;
    else throw new Error(`알 수 없는 인자다: ${a}`);
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`포트가 올바르지 않다: ${port}`);
  if (gitPort !== undefined && (!Number.isInteger(gitPort) || gitPort < 0 || gitPort > 65535)) throw new Error(`git 포트가 올바르지 않다: ${gitPort}`);
  if (gitPort !== undefined && gitPort !== 0 && gitPort === port) throw new Error(`git 포트는 주 포트와 달라야 한다: ${gitPort}`);
  if (graphHub !== undefined && (!Number.isInteger(graphHub) || graphHub < 1)) throw new Error(`--graph-hub 는 양의 정수여야 한다: ${graphHub}`);
  // 루프백이 아닌 Ollama 는 시작부터 거부한다 — 본문이 밖으로 나가면 안 된다.
  ollamaUrl = assertLoopbackUrl(ollamaUrl);
  if (!/^[A-Za-z0-9][\w.:/-]*$/.test(embedModel)) throw new Error(`--embed-model 이 올바르지 않다: ${embedModel}`);
  // CLI 가 있으면 환경 변수는 무시한다. 형식이 틀리면 여기서 멈춘다.
  const prRepos = parseRepos(cliRepos, env.KNOWLEDGE_VIEWER_PR_REPOS);
  // 주지 않은 선택 인자는 키째 뺀다.
  return {
    vault,
    port,
    ...(gitPort === undefined ? {} : { gitPort }),
    includePrivate,
    prRepos,
    ...(graphHub === undefined ? {} : { graphHub }),
    embed,
    ollamaUrl,
    embedModel,
  };
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// start.ts도 같은 프로세스에서 부를 수 있게 내보낸다. 서버가 listen하면 끝난다(프로세스는 서버가 붙들고 있다).
export function runCli(argv: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const args = parseArgs(argv);
      const root = findVaultRoot(args.vault ?? process.cwd());
      const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
      const server = createViewerServer({
        root,
        includePrivate: args.includePrivate,
        distDir,
        prRepos: args.prRepos,
        gitPort: args.gitPort,
        graphHub: args.graphHub,
        embeddings: args.embed ? { ollamaUrl: args.ollamaUrl, model: args.embedModel } : false,
      });
      listenViewer(server, args.port, args.gitPort).then(({ port, gitPort }) => {
        console.log(`knowledge-viewer http://127.0.0.1:${port}/ (vault: ${root}) · git 소스 출처 http://localhost:${gitPort}/raw/@…`);
        resolve();
      }, reject);
    } catch (e) {
      reject(e);
    }
  });
}

if (isMain()) {
  runCli(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
