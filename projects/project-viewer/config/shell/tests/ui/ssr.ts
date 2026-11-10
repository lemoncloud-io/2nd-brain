// 컴포넌트(.tsx)를 node --test에서 정적 마크업으로 그려 보는 조립기. 테스트 러너는 *.test.ts만
// 실행하므로 이 파일은 자동 실행되지 않는다. JSX 변환은 이미 선언된 vite의 SSR 적재기에 맡긴다 —
// 새 의존성을 들이지 않는다.
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

const SHELL_DIR = fileURLToPath(new URL('../..', import.meta.url));

export type Load = (path: string) => Promise<Record<string, unknown>>;

export async function withSsr<T>(run: (load: Load) => Promise<T>): Promise<T> {
  const server = await createServer({
    configFile: false,
    root: SHELL_DIR,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    esbuild: { jsx: 'automatic' },
  });
  try {
    return await run((p) => server.ssrLoadModule(p));
  } finally {
    await server.close();
  }
}
