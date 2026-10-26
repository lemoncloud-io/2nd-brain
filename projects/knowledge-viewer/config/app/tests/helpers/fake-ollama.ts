// 시험용 가짜 Ollama. /api/tags 와 /api/embed 만 답한다. 실제 Ollama 는 손 확인에서만 쓴다.
// 벡터는 글에서 결정적으로 만든다: 글에 든 낱말(`alpha`·`beta` …)마다 정해진 축에 1 을 더한다 — 같은 낱말을 가진 문서끼리 가깝다.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export const FAKE_DIM = 8;
const AXES = ['alpha', 'beta', 'gamma', 'delta', '알파', '베타', '감마', '델타'];

export function fakeVector(text: string): number[] {
  const v = new Array<number>(FAKE_DIM).fill(0.01);
  const lower = text.toLowerCase();
  AXES.forEach((w, i) => {
    if (lower.includes(w)) v[i % FAKE_DIM]! += 1;
  });
  return v;
}

export type FakeOllama = {
  url: string;
  /** /api/embed 로 받은 글 전부(요청 순). */
  inputs: string[];
  /** /api/embed 요청 수. */
  requests: number;
  /** 모델 목록. 바꿔 끼울 수 있다. */
  models: string[];
  /** 이 글이 든 입력은 실패시킨다(500). */
  failOn: string | null;
  close(): Promise<void>;
};

export async function startFakeOllama(models: string[] = ['embeddinggemma-2:270m-q8_0-text']): Promise<FakeOllama> {
  const state = { inputs: [] as string[], requests: 0, models, failOn: null as string | null };
  const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/api/tags') {
      send(200, { models: state.models.map((name) => ({ name, model: name })) });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/embed') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        state.requests += 1;
        const body = JSON.parse(raw) as { model: string; input: string[] };
        if (!state.models.some((m) => m === body.model || m === `${body.model}:latest`)) {
          send(404, { error: 'model not found' });
          return;
        }
        if (state.failOn !== null && body.input.some((t) => t.includes(state.failOn!))) {
          send(500, { error: 'boom' });
          return;
        }
        state.inputs.push(...body.input);
        send(200, { model: body.model, embeddings: body.input.map(fakeVector) });
      });
      return;
    }
    send(404, { error: 'not found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return Object.assign(state, {
    url,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  }) as FakeOllama;
}

/** 아무도 듣지 않는 루프백 주소(Ollama 꺼짐). 포트를 잠깐 열었다 닫아 얻는다. */
export async function deadOllamaUrl(): Promise<string> {
  const s = http.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return `http://127.0.0.1:${port}`;
}
