// /api/panels/* 라우트. 순수 함수다: (src, url) → Promise<ApiResult>. 소켓은 main.ts 가 만진다.
import type { ApiResult } from '../handlers.ts';
import type { PrSource } from './prs.ts';
import type { ViewersSource } from './viewers.ts';

const fail = (status: number, error: string): ApiResult => ({ status, body: { error } });

const NUMBER_RE = /^\d{1,9}$/;

/** viewers 가 없으면(옛 호출자·PR 패널 시험) /api/panels/viewers 는 404 다. */
export async function handlePanels(src: PrSource, url: URL, viewers?: ViewersSource): Promise<ApiResult> {
  const repo = url.searchParams.get('repo');
  const refresh = url.searchParams.get('refresh') === '1';
  try {
    switch (url.pathname) {
      case '/api/panels/prs/repos':
        return { status: 200, body: await src.repos(refresh) };
      case '/api/panels/prs':
        return { status: 200, body: await src.list(repo, refresh) };
      case '/api/panels/viewers':
        if (viewers === undefined) return fail(404, `알 수 없는 API다: ${url.pathname}`);
        return { status: 200, body: await viewers.list(refresh) };
      case '/api/panels/prs/files': {
        const n = url.searchParams.get('number');
        if (n === null || !NUMBER_RE.test(n)) return fail(400, 'number 는 양의 정수여야 한다');
        return { status: 200, body: await src.files(repo, Number(n), refresh) };
      }
      default:
        return fail(404, `알 수 없는 API다: ${url.pathname}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith('허용되지 않은 레포')) return fail(400, msg);
    throw e;
  }
}
