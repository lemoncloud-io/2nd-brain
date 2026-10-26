// 뷰어 모음 패널의 데이터 소스. 볼트 전용 등록부(projects/knowledge-viewer/viewers.yml — viewers-build 가 스킬의 viewer
// 블록으로 만든 생성 파일)를 읽어 항목마다 상태를 붙인다.
// static 은 파일 존재(ok·missing), server 는 127.0.0.1:<port> TCP 핑(up·down), 포트가 없으면 manual 이다.
// 이 모듈은 읽기만 한다 — 명령을 실행하지 않는다. 서버 띄우기는 사용자가 ask 문장으로 클로드에게 맡긴다.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { parse } from 'yaml';

import { isFileInside, resolveDiskPath } from '../handlers.ts';

export const REGISTRY_PATH = 'projects/knowledge-viewer/viewers.yml';
export const PING_TIMEOUT_MS = 300;
export const VIEWERS_TTL_MS = 10_000;
/** project-viewers 가 펼치는 산출물 위치: projects/<name>/outputs/viewer/index.html */
const PROJECT_VIEWER_FILE = 'outputs/viewer/index.html';

export type ViewerStatus = 'ok' | 'missing' | 'up' | 'down' | 'manual';
export type ViewerOpen =
  | { kind: 'static'; path: string; ask: string | null }
  | { kind: 'server'; url: string | null; port: number | null; launch: string | null; ask: string };
export type Viewer = {
  id: string;
  title: string;
  description: string;
  /** 지침서(SKILL.md) 볼트 상대경로. */
  skill: string;
  open: ViewerOpen;
  status: ViewerStatus;
  /** 펼친 항목의 묶음 이름(project-viewers). 없으면 null. */
  group: string | null;
};
export type ViewersResult = { viewers: Viewer[]; fetchedAt: string; error: string | null };

/** 핑. true 면 up. 시험이 바꾼다. */
export type Pinger = (port: number) => Promise<boolean>;

/** 127.0.0.1:<port> 에 TCP 연결이 열리면 up. 타임아웃·거절은 down. 바이트는 보내지 않는다. */
export function tcpPing(port: number, timeoutMs = PING_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    let done = false;
    const finish = (up: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(up);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
  });
}

type RawOpen =
  | { kind: 'static'; path: string; ask: string | null }
  | { kind: 'server'; url: string | null; port: number | null; launch: string | null; ask: string }
  | { kind: 'project-viewers'; ask: string | null };
export type RawEntry = { id: string; title: string; description: string; skill: string; open: RawOpen };

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const LAUNCH_RE = /^[A-Za-z0-9_.-]+$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' && !/[\r\n]/.test(v.trim()) ? v.trim() : null);

/** 볼트 상대경로 문법만 본다(존재는 상태가 맡는다). 절대경로·`..`·빈 마디는 거절. */
function isVaultRel(p: string): boolean {
  if (p.startsWith('/') || p.includes('\\')) return false;
  return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** 항목 하나를 검사한다. 실패면 한 줄 사유. 빌더(viewers-build)도 같은 검사를 쓴다. */
export function parseEntry(raw: unknown, n: number): RawEntry | string {
  const at = `${n}번째 항목`;
  if (!isObj(raw)) return `${at}이 객체가 아니다`;
  const id = text(raw.id);
  if (id === null) return `${at}에 id 가 없다`;
  const who = `${at}(${id})`;
  if (!ID_RE.test(id)) return `${who}: id 는 소문자·숫자·- 만 쓴다`;
  const title = text(raw.title);
  if (title === null) return `${who}에 title 이 없다`;
  const description = text(raw.description);
  if (description === null) return `${who}에 description 이 없다`;
  const skill = text(raw.skill);
  if (skill === null) return `${who}에 skill 이 없다`;
  if (!isVaultRel(skill) || !skill.endsWith('/SKILL.md')) return `${who}: skill 은 SKILL.md 의 볼트 상대경로여야 한다`;
  const o = raw.open;
  if (!isObj(o)) return `${who}에 open 이 없다`;
  const ask = text(o.ask);
  if (o.kind === 'static') {
    const p = text(o.path);
    if (p === null) return `${who}: open.path 가 없다`;
    if (!isVaultRel(p) || !/\.html?$/i.test(p)) return `${who}: open.path 는 html 의 볼트 상대경로여야 한다`;
    return { id, title, description, skill, open: { kind: 'static', path: p, ask } };
  }
  if (o.kind === 'server') {
    if (ask === null) return `${who}: open.ask 가 없다`;
    let port: number | null = null;
    if (o.port !== undefined) {
      if (typeof o.port !== 'number' || !Number.isInteger(o.port) || o.port < 1 || o.port > 65535) return `${who}: open.port 는 1~65535 정수다`;
      port = o.port;
    }
    let url: string | null = null;
    if (o.url !== undefined) {
      url = text(o.url);
      let u: URL;
      try {
        u = new URL(url ?? '');
      } catch {
        return `${who}: open.url 이 주소가 아니다`;
      }
      // 등록부가 바깥 주소·스크립트 주소를 싣지 못하게: 루프백 http 만.
      if (u.protocol !== 'http:' || !LOOPBACK.has(u.hostname)) return `${who}: open.url 은 http://127.0.0.1 또는 http://localhost 여야 한다`;
      if (port === null) return `${who}: open.url 이 있으면 open.port 도 있어야 한다`;
      if (Number(u.port || 80) !== port) return `${who}: open.url 의 포트가 open.port(${port})와 다르다`;
    }
    let launch: string | null = null;
    if (o.launch !== undefined) {
      launch = text(o.launch);
      if (launch === null || !LAUNCH_RE.test(launch)) return `${who}: open.launch 는 launch.json 항목 이름이다`;
    }
    return { id, title, description, skill, open: { kind: 'server', url, port, launch, ask } };
  }
  if (o.kind === 'project-viewers') return { id, title, description, skill, open: { kind: 'project-viewers', ask } };
  return `${who}: open.kind 는 static·server·project-viewers 중 하나다`;
}

/** 등록부 본문 → 항목·오류. 틀린 항목은 빼고 첫 사유를 한 줄로 싣는다(나머지는 "외 n건"). */
export function parseRegistry(source: string): { entries: RawEntry[]; error: string | null } {
  let doc: unknown;
  try {
    doc = parse(source);
  } catch (e) {
    const first = (e instanceof Error ? e.message : String(e)).split('\n')[0];
    return { entries: [], error: `viewers.yml 을 읽지 못했다: ${first}` };
  }
  if (!isObj(doc) || !Array.isArray(doc.viewers)) return { entries: [], error: 'viewers.yml 에 viewers 목록이 없다' };
  const entries: RawEntry[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  doc.viewers.forEach((raw, i) => {
    const r = parseEntry(raw, i + 1);
    if (typeof r === 'string') problems.push(r);
    else if (seen.has(r.id)) problems.push(`${i + 1}번째 항목(${r.id}): id 가 겹친다`);
    else {
      seen.add(r.id);
      entries.push(r);
    }
  });
  const error = problems.length === 0 ? null : `viewers.yml: ${problems[0]}${problems.length > 1 ? ` 외 ${problems.length - 1}건` : ''}`;
  return { entries, error };
}

type Cached = { at: number; value: ViewersResult };

export type ViewersSourceOptions = {
  root: string;
  includePrivate: boolean;
  /** 등록부 볼트 상대경로. 기본 REGISTRY_PATH. */
  registry?: string;
  ping?: Pinger;
  now?: () => number;
  ttlMs?: number;
};

export class ViewersSource {
  private readonly root: string;
  private readonly includePrivate: boolean;
  private readonly registry: string;
  private readonly ping: Pinger;
  private readonly now: () => number;
  private readonly ttl: number;
  private cached: Cached | null = null;

  constructor(opts: ViewersSourceOptions) {
    this.root = opts.root;
    this.includePrivate = opts.includePrivate;
    this.registry = opts.registry ?? REGISTRY_PATH;
    this.ping = opts.ping ?? ((port) => tcpPing(port));
    this.now = opts.now ?? Date.now;
    this.ttl = opts.ttlMs ?? VIEWERS_TTL_MS;
  }

  private exists(rel: string): boolean {
    const abs = resolveDiskPath({ root: this.root, includePrivate: this.includePrivate }, rel);
    return abs !== null && isFileInside(this.root, abs);
  }

  /** projects/<name>/outputs/viewer/index.html 이 있는 프로젝트. 이름순. 제목은 config/viewer.yml 의 meta.title. */
  private projectViewers(): { name: string; path: string; title: string | null; summary: string | null }[] {
    let names: string[];
    try {
      names = fs.readdirSync(path.join(this.root, 'projects'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return [];
    }
    const out: { name: string; path: string; title: string | null; summary: string | null }[] = [];
    for (const name of names.sort()) {
      const rel = `projects/${name}/${PROJECT_VIEWER_FILE}`;
      if (!this.exists(rel)) continue;
      let title: string | null = null;
      let summary: string | null = null;
      try {
        const meta = (parse(fs.readFileSync(path.join(this.root, 'projects', name, 'config', 'viewer.yml'), 'utf8')) as { meta?: unknown })?.meta;
        if (isObj(meta)) {
          title = text(meta.title);
          summary = text(meta.summary);
        }
      } catch {
        // viewer.yml 이 없거나 깨졌으면 이름으로 부른다.
      }
      out.push({ name, path: rel, title, summary });
    }
    return out;
  }

  private async build(): Promise<ViewersResult> {
    const fetchedAt = new Date(this.now()).toISOString();
    if (!this.exists(this.registry)) return { viewers: [], fetchedAt, error: `등록부가 없다: ${this.registry} — 볼트에서 npm run viewers-build 로 만든다` };
    let source: string;
    try {
      source = fs.readFileSync(path.join(this.root, this.registry), 'utf8');
    } catch {
      return { viewers: [], fetchedAt, error: `등록부를 읽지 못했다: ${this.registry}` };
    }
    const { entries, error } = parseRegistry(source);
    const viewers: Viewer[] = [];
    const pings: Promise<void>[] = [];
    for (const e of entries) {
      const base = { id: e.id, title: e.title, description: e.description, skill: e.skill };
      const o = e.open;
      if (o.kind === 'static') {
        viewers.push({ ...base, open: o, status: this.exists(o.path) ? 'ok' : 'missing', group: null });
      } else if (o.kind === 'project-viewers') {
        for (const pv of this.projectViewers()) {
          viewers.push({
            id: `${e.id}:${pv.name}`,
            title: pv.title ?? `${pv.name} 뷰어`,
            description: pv.summary ?? e.description,
            skill: e.skill,
            open: { kind: 'static', path: pv.path, ask: o.ask ?? `${pv.name} 뷰어 보여줘` },
            status: 'ok',
            group: e.title,
          });
        }
      } else {
        const v: Viewer = { ...base, open: o, status: o.port === null ? 'manual' : 'down', group: null };
        viewers.push(v);
        if (o.port !== null) {
          const port = o.port;
          pings.push(this.ping(port).then((up) => void (v.status = up ? 'up' : 'down'), () => void (v.status = 'down')));
        }
      }
    }
    await Promise.all(pings);
    return { viewers, fetchedAt, error };
  }

  async list(refresh = false): Promise<ViewersResult> {
    const c = this.cached;
    if (c && !refresh && this.now() - c.at < this.ttl) return c.value;
    const value = await this.build();
    this.cached = { at: this.now(), value };
    return value;
  }
}
