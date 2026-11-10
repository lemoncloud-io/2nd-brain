// 앱 목록 API(`GET /api/apps`). 서버 server/apps/host.ts 의 AppListEntry 와 같은 모양이다. 토큰은 싣지 않는다.

/** 앱 한 줄. ready 가 false 면 reason(import 실패·저장소 경계 등)이 있다. */
export type AppEntry = { id: string; title: string; ready: boolean; reason?: string };

/** 앱 목록을 받는다. 실패하면 던진다(패널이 받아 조용히 비운다). */
export async function getApps(): Promise<AppEntry[]> {
  const res = await fetch('/api/apps');
  const json: unknown = await res.json();
  if (!res.ok || typeof json !== 'object' || json === null || !Array.isArray((json as { apps?: unknown }).apps)) throw new Error(`HTTP ${res.status}`);
  return (json as { apps: AppEntry[] }).apps;
}
