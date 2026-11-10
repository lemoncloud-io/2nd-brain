// 개인 이름 뒤의 상시 뷰어가 이 세션의 볼트 루트를 내는지 본다. 스킬 knowledge-viewer-open 이 부른다.
// 그 서버 /api/info 의 rootId(볼트 루트 폴더의 지문)와 이 볼트 루트의 rootId 를 견준다. 결과는 JSON 한 줄이다.
// node_modules 없이 돈다(node 내장만) — 서버를 띄우기 전에 부르기 때문이다.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { rootId } from './server/info.ts';
import { findVaultRoot } from './shared/vault.ts';

const USAGE = '사용법: node same-vault.ts <뷰어 주소> [--vault DIR]';
const TIMEOUT_MS = 3_000;

/** same: 같은 폴더를 내는가. port: 그 서버의 주 포트(rawPort, 알면). reason: 한 줄 사유. */
export type SameVault = { same: boolean; port?: number; reason: string };

export async function sameVault(url: string, dir: string, fetchImpl: typeof fetch = fetch): Promise<SameVault> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return { same: false, reason: `주소가 올바르지 않다: ${url}` };
  }
  let local: string;
  try {
    local = rootId(findVaultRoot(dir));
  } catch (e) {
    return { same: false, reason: e instanceof Error ? e.message : String(e) };
  }
  let info: unknown;
  try {
    const res = await fetchImpl(`${origin}/api/info`, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' });
    if (!res.ok) return { same: false, reason: `/api/info 가 ${res.status} — 그 이름을 받는 뷰어가 아니다` };
    info = await res.json();
  } catch (e) {
    return { same: false, reason: `/api/info 를 읽지 못했다: ${e instanceof Error ? e.message : String(e)}` };
  }
  const o = typeof info === 'object' && info !== null ? (info as { rootId?: unknown; rawPort?: unknown }) : {};
  const port = typeof o.rawPort === 'number' && Number.isInteger(o.rawPort) ? { port: o.rawPort } : {};
  if (typeof o.rootId !== 'string') return { same: false, ...port, reason: 'rootId 가 없다 — 개인 이름 설정이 없거나 옛 서버다' };
  if (o.rootId !== local) return { same: false, ...port, reason: '다른 볼트 루트를 낸다(예: 이 세션은 워크트리, 상시 서버는 메인 체크아웃)' };
  return { same: true, ...port, reason: '같은 볼트 루트' };
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

if (isMain()) {
  const argv = process.argv.slice(2);
  let url: string | undefined;
  let vault = process.cwd();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (a === '--vault') vault = argv[(i += 1)] ?? vault;
    else if (url === undefined && !a.startsWith('--')) url = a;
    else {
      console.error(`알 수 없는 인자다: ${a}\n${USAGE}`);
      process.exit(2);
    }
  }
  if (url === undefined) {
    console.error(USAGE);
    process.exit(2);
  }
  sameVault(url, vault).then((r) => console.log(JSON.stringify(r)));
}
