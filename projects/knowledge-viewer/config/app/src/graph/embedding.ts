// 임베딩 묶음의 화면 상태(⚙ 설정·조절 패널·지도가 같이 본다). 그래프 라이브러리를 불러오지 않는다(index 청크에 들어간다).
// 서버가 /api/info 로 "쓸 수 있음" 을 알려야 선택지가 나온다. 켜기는 브라우저 설정이고, 켜면 상태를 묻고 색인 전이면 색인을 시작한다.
// 색인 중에는 3 초마다 상태를 다시 묻는다. 상태 모양의 정본은 server/embeddings.ts 의 EmbedStatus 다.
import { readGraphEmbedding, writeGraphEmbedding } from '../app/prefs/graph.ts';

export type EmbedState = 'off' | 'no-ollama' | 'no-model' | 'idle' | 'building' | 'ready';
export type EmbedStatus = {
  state: EmbedState;
  model: string | null;
  done: number;
  total: number;
  failed: number;
  builtAt: string | null;
  clusters: number;
  hint?: string;
};

export type EmbeddingView = {
  /** 서버가 임베딩을 쓸 수 있다고 알렸는가(/api/info embeddings.available). */
  available: boolean;
  model: string | null;
  /** 사용자가 켰는가(브라우저 설정). */
  enabled: boolean;
  /** 마지막으로 받은 서버 상태. 아직 묻지 않았으면 null. */
  status: EmbedStatus | null;
  /** 상태를 묻다 실패한 까닭. */
  error: string | null;
};

export const EMBED_POLL_MS = 3_000;
export const STATUS_PATH = '/api/graph/embeddings/status';
export const BUILD_PATH = '/api/graph/embeddings/build';

/** 묶음 `임베딩` 을 실제로 쓸 수 있는가 — 서버가 알리고, 사용자가 켰고, 군집이 준비됐다. */
export function embeddingReady(v: EmbeddingView): boolean {
  return v.available && v.enabled && v.status?.state === 'ready';
}

/** 지도 질의에 싣는 표지. 준비됐을 때만 군집 시각(바뀌면 지도를 다시 받는다), 아니면 undefined(서버가 군집을 싣지 않는다). */
export function embeddingToken(v: EmbeddingView): string | undefined {
  return embeddingReady(v) ? (v.status?.builtAt ?? 'ready') : undefined;
}

/** ⚙ 설정 줄의 상태 글. */
export function embeddingStatusText(v: EmbeddingView): string {
  if (!v.enabled) return '꺼짐';
  if (v.error !== null) return `상태를 못 읽었다: ${v.error}`;
  const s = v.status;
  if (s === null) return '확인 중…';
  switch (s.state) {
    case 'off':
      return '서버에서 꺼짐';
    case 'no-ollama':
      return 'Ollama 없음 — ollama serve 로 켠다';
    case 'no-model':
      return `모델 없음 — ${s.hint ?? `ollama pull ${s.model ?? ''}`}`;
    case 'idle':
      return s.done > 0 ? `색인 필요 (${s.done}/${s.total})` : '색인 전';
    case 'building':
      return `색인 중 ${s.done}/${s.total}`;
    case 'ready': {
      const stale = s.total - s.done;
      return `준비됨 · ${s.clusters} 군집${stale > 0 ? ` · 낡음 ${stale}` : ''}${s.failed > 0 ? ` · 실패 ${s.failed}` : ''}${s.hint === undefined ? '' : ` · 색인 못 함: ${s.hint}`}`;
    }
  }
}

/** 조절 패널의 `임베딩` 라디오가 비활성인 까닭(title). 쓸 수 있으면 null. */
export function embeddingDisabledReason(v: EmbeddingView): string | null {
  if (embeddingReady(v)) return null;
  if (!v.enabled) return '⚙ 설정의 지도 › 임베딩 묶음을 켜야 고를 수 있다';
  return `임베딩 군집이 아직 없다 — ${embeddingStatusText(v)}`;
}

type Deps = {
  fetch: (url: string, init?: { method?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  readEnabled: () => boolean;
  writeEnabled: (on: boolean) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (t: unknown) => void;
};

export type EmbeddingStore = {
  get(): EmbeddingView;
  subscribe(fn: () => void): () => void;
  /** /api/info 의 embeddings 를 받는다. 쓸 수 있고 켜져 있으면 상태를 묻는다(다음 세션에서도 다시 묻는다). */
  setAvailable(info: { available: boolean; model: string | null } | undefined): void;
  /** 켜기·끄기. 켜면 상태를 묻고 색인 전(idle)이면 색인을 시작한다. */
  setEnabled(on: boolean): Promise<void>;
  /** 색인 시작(이미 돌면 진행률만). */
  build(): Promise<void>;
  refresh(): Promise<void>;
};

export function createEmbeddingStore(deps: Deps): EmbeddingStore {
  let view: EmbeddingView = { available: false, model: null, enabled: deps.readEnabled(), status: null, error: null };
  const subs = new Set<() => void>();
  let timer: unknown = null;
  const set = (patch: Partial<EmbeddingView>) => {
    view = { ...view, ...patch };
    for (const fn of subs) fn();
  };
  const stopPoll = () => {
    if (timer !== null) deps.clearTimeout(timer);
    timer = null;
  };
  // 색인 중이면 3 초 뒤 다시 묻는다. 꺼졌으면 멈춘다.
  const schedule = () => {
    stopPoll();
    if (!view.enabled || view.status?.state !== 'building') return;
    timer = deps.setTimeout(() => {
      timer = null;
      void refresh();
    }, EMBED_POLL_MS);
  };
  const call = async (url: string, method?: string): Promise<void> => {
    try {
      const res = await deps.fetch(url, method === undefined ? undefined : { method });
      const body = (await res.json().catch(() => null)) as EmbedStatus | { error?: string } | null;
      if (!res.ok || body === null || !('state' in body)) {
        const msg = body !== null && 'error' in body && typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
        set({ error: msg });
        return;
      }
      set({ status: body, error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
    schedule();
  };
  const refresh = () => call(STATUS_PATH);
  const build = () => call(BUILD_PATH, 'POST');
  return {
    get: () => view,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    setAvailable(info) {
      const available = info?.available === true;
      set({ available, model: info?.model ?? null });
      if (available && view.enabled) void refresh();
      else stopPoll();
    },
    async setEnabled(on) {
      deps.writeEnabled(on);
      set({ enabled: on, error: null });
      if (!on) {
        stopPoll();
        return;
      }
      if (!view.available) return;
      await refresh();
      if (view.status?.state === 'idle') await build();
    },
    build,
    refresh,
  };
}

/** 앱 하나에 하나. 브라우저 fetch·localStorage·타이머를 쓴다. */
export const embeddingStore: EmbeddingStore = createEmbeddingStore({
  fetch: (url, init) => fetch(url, init),
  readEnabled: readGraphEmbedding,
  writeEnabled: writeGraphEmbedding,
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (t) => globalThis.clearTimeout(t as ReturnType<typeof setTimeout>),
});
