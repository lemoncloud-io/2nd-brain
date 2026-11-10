// 확장 층(ext) 찾기. 확장은 이 유닛 밖, 볼트가 소유하는 폴더(기본 `<유닛>/../ext`)에 둔다.
// 빌드(vite.config.ts)·시작(start.ts)·서버(server/main.ts)가 같은 함수로 같은 폴더를 읽는다.
// 런타임 import 는 node 내장뿐이다 — 설치 전(start.ts)과 Vite 설정을 읽을 때도 쓰인다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 확장 폴더를 바꾸는 환경 변수. `off` 면 확장 없음, 그 밖의 값은 폴더 경로다. */
export const EXT_ENV = 'KNOWLEDGE_VIEWER_EXT';

/** 화면 확장 가상 모듈 id. 확장의 `ui.ts` 가 있으면 그것, 없으면 빈 모듈로 풀린다. */
export const EXT_UI_ID = 'virtual:knowledge-viewer-ext/ui';

const appDir = path.dirname(fileURLToPath(import.meta.url));

/** 기본 확장 폴더: 이 앱(config/app)에서 두 단계 위의 `ext`. 빌드하는 체크아웃의 것이다(--vault 와 무관). */
export const DEFAULT_EXT_DIR = path.resolve(appDir, '..', '..', 'ext');

/** 화면 확장이 없을 때 가상 모듈이 풀리는 빈 모듈. */
export const EMPTY_UI_FILE = path.join(appDir, 'src', 'ext', 'empty.ts');

/**
 * 쓸 확장 폴더(절대경로). `off` 이거나 기본 폴더가 없으면 null(확장 없음).
 * 환경 변수로 준 폴더가 없으면 던진다 — 일부러 가리킨 확장이 조용히 사라지지 않게.
 */
export function extDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[EXT_ENV];
  if (raw === 'off') return null;
  if (raw !== undefined && raw !== '') {
    const dir = path.resolve(raw);
    if (!fs.existsSync(dir)) throw new Error(`${EXT_ENV} 가 가리키는 확장 폴더가 없다: ${dir}`);
    return dir;
  }
  return fs.existsSync(DEFAULT_EXT_DIR) ? DEFAULT_EXT_DIR : null;
}

/** 확장 폴더 안의 파일(절대경로). 확장이 없거나 그 파일이 없으면 null. */
export function extFile(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const dir = extDir(env);
  if (dir === null) return null;
  const file = path.join(dir, name);
  return fs.existsSync(file) ? file : null;
}
