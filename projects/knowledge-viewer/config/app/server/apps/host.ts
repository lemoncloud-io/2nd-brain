// 앱 플러그인 실행부. 등록부(registry.ts)의 앱을 첫 요청 때 만들고(지연), 요청을 그 앱 핸들러로 넘기고, 서버가 닫힐 때 닫는다.
// 앱 하나가 import·생성에 실패하거나 저장소 경계를 어기면 그 앱만 503 이다 — 다른 앱과 뷰어는 그대로 돈다.
// 메서드·호스트·출처·토큰 검사는 main.ts 가 먼저 한다. 여기는 이미 통과한 요청만 받는다.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type http from 'node:http';

import { APP_ID, appBasePath, assertApps, storeDirProblem, type AppServer, type ViewerApp } from './registry.ts';

/** `/api/apps` 목록 한 줄. reason 은 ready 가 false 일 때만(import 실패·저장소 경계 등). */
export type AppListEntry = { id: string; title: string; ready: boolean; reason?: string };

/** 앱 하나의 상태. 생성은 한 번만 시도한다 — 실패는 프로세스가 사는 동안 그대로 남는다(다시 띄우면 다시 시도). token 은 이 앱만의 토큰이다. */
type Slot = { app: ViewerApp; token: string; blocked: string | null; pending: Promise<AppServer> | null; server: AppServer | null; reason: string | null };

/** `/api/apps/<id>` 또는 `/api/apps/<id>/…` 면 id, 아니면 null. pathname 은 질의 없이, 인코딩된 그대로 받는다. */
export function matchAppApi(pathname: string): string | null {
  const m = /^\/api\/apps\/([^/]+)(?:\/.*)?$/s.exec(pathname);
  return m !== null && APP_ID.test(m[1]!) ? m[1]! : null;
}

/** `/apps/<id>`·`/apps/<id>/…` 면 id, 아니면 null. 화면(SPA) 주소다. */
export function matchAppPage(pathname: string): string | null {
  const m = /^\/apps\/([^/]+)(?:\/.*)?$/s.exec(pathname);
  return m !== null && APP_ID.test(m[1]!) ? m[1]! : null;
}

/** 앱 토큰 하나(32바이트 hex). 앱마다 하나씩 만든다. 로그·/api/info 에 싣지 않는다. */
export const newAppToken = (): string => randomBytes(32).toString('hex');

/** 길이가 달라도 던지지 않는 상수 시간 비교. */
export function tokenMatches(given: string | string[] | undefined, token: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** JSON 한 덩이로 답한다. HEAD 는 몸통 없이. */
function sendJson(req: http.IncomingMessage, res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(Buffer.byteLength(text)), 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : text);
}

export class AppRuntime {
  private readonly slots = new Map<string, Slot>();
  private closed = false;

  private readonly opts: { vaultRoot: string; env: NodeJS.ProcessEnv; log: (line: string) => void };

  constructor(apps: ViewerApp[], opts: { vaultRoot: string; env: NodeJS.ProcessEnv; log: (line: string) => void }) {
    this.opts = opts;
    // 등록부 실수(id 문법·중복)는 시작부터 멈춘다. 저장소 경계는 그 앱만 막는다.
    assertApps(apps);
    // 토큰은 앱마다 하나 — 한 앱 화면의 결함이 다른 앱 API 로 번지지 않게(설계 결정 4).
    for (const app of apps) this.slots.set(app.id, { app, token: newAppToken(), blocked: storeDirProblem(app, opts.vaultRoot), pending: null, server: null, reason: null });
  }

  /** 등록된 id 인가. */
  has(id: string): boolean {
    return this.slots.has(id);
  }

  /** 그 앱의 토큰. 등록되지 않은 id 면 null — 토큰을 내지 않는다. */
  tokenOf(id: string): string | null {
    return this.slots.get(id)?.token ?? null;
  }

  /** 요청 토큰이 그 앱의 토큰과 같은가. 등록되지 않은 id 는 언제나 false. */
  tokenAllows(id: string, given: string | string[] | undefined): boolean {
    const token = this.tokenOf(id);
    return token !== null && tokenMatches(given, token);
  }

  /** 앱을 (처음이면) 만든다. 성공하면 AppServer, 실패하면 그 까닭 문자열. */
  private async ensure(slot: Slot): Promise<AppServer | string> {
    if (slot.blocked !== null) return slot.blocked;
    if (slot.server !== null) return slot.server;
    if (slot.reason !== null) return slot.reason;
    if (this.closed) return '서버가 닫히는 중이다';
    // 동시에 온 첫 요청들은 같은 생성을 기다린다.
    if (slot.pending === null) {
      const { app } = slot;
      const log = (line: string): void => this.opts.log(`[앱 ${app.id}] ${line}`);
      // 동기로 던져도 거부로 바꾼다(아래 catch 가 받게).
      slot.pending = Promise.resolve().then(() => app.server({ vaultRoot: this.opts.vaultRoot, basePath: appBasePath(app.id), token: slot.token, env: this.opts.env, log }));
    }
    try {
      const server = await slot.pending;
      slot.server = server;
      // 만드는 사이 뷰어가 닫혔으면 바로 닫는다.
      if (this.closed) void server.close().catch(() => {});
      return server;
    } catch (e) {
      slot.reason ??= e instanceof Error ? e.message : String(e);
      this.opts.log(`앱 ${slot.app.id} 을 열지 못했다: ${slot.reason}`);
      return slot.reason;
    }
  }

  /** `/api/apps` — 모든 앱을 (처음이면) 만들어 보고 상태를 낸다. */
  async list(): Promise<{ apps: AppListEntry[] }> {
    const out: AppListEntry[] = [];
    for (const slot of this.slots.values()) {
      const r = await this.ensure(slot);
      out.push(typeof r === 'string' ? { id: slot.app.id, title: slot.app.title, ready: false, reason: r } : { id: slot.app.id, title: slot.app.title, ready: true });
    }
    return { apps: out };
  }

  /** 요청을 앱으로 넘긴다. req.url 은 고치지 않는다(앱이 basePath 를 뗀다). 앱을 못 만들면 503. */
  dispatch(id: string, req: http.IncomingMessage, res: http.ServerResponse): void {
    const slot = this.slots.get(id);
    if (slot === undefined) {
      sendJson(req, res, 404, { error: '없는 앱이다' });
      return;
    }
    this.ensure(slot)
      .then((r) => {
        if (typeof r === 'string') {
          sendJson(req, res, 503, { error: '앱을 쓸 수 없다', reason: r });
          return;
        }
        r.handle(req, res);
      })
      .catch((e: unknown) => {
        // 앱 핸들러가 동기로 던진 것도 여기서 끝낸다 — 뷰어 프로세스가 죽지 않게.
        console.error(e);
        if (!res.headersSent) sendJson(req, res, 500, { error: '내부 오류' });
        else res.destroy();
      });
  }

  /** 만든 앱을 모두 닫는다. 한 앱의 실패가 다른 앱 닫기를 막지 않는다. */
  async close(): Promise<void> {
    this.closed = true;
    const live = [...this.slots.values()].map((s) => s.server).filter((s): s is AppServer => s !== null);
    await Promise.allSettled(live.map((s) => s.close()));
  }
}
