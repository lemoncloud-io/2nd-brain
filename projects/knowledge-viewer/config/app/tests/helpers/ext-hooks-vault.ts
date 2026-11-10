// 확장을 실어 보는 시험의 해석(확장 폴더의 `npm test` 가 `node --import` 로 먼저 부른다).
//  1. 화면 확장 가상 모듈을 실제 확장 ui.ts(KNOWLEDGE_VIEWER_EXT 규칙)로 푼다. 없으면 빈 모듈.
//  2. .tsx·CSS·셸 바꿔 끼우기는 tsx-hooks.ts 그대로.
//  3. 유닛 밖 파일이 부르는 React 계열은 이 앱의 한 벌로 푼다(Vite dedupe 와 같은 뜻 — 두 벌이면 훅이 깨진다).
//     그 밖의 이름 import 도 제자리에서 못 찾으면 이 앱 기준으로 한 번 더 찾는다(확장 폴더에는 node_modules 가 없다).
import './tsx-hooks.ts';

import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { EMPTY_UI_FILE, EXT_UI_ID, extFile } from '../../ext-locate.ts';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..') + path.sep;
const APP_URL = pathToFileURL(APP_DIR).href;
const UI_URL = pathToFileURL(extFile('ui.ts') ?? EMPTY_UI_FILE).href;

/** 한 벌로 맞출 패키지(이름 또는 그 하위 경로). */
const DEDUPE = /^(react|react-dom|react-router-dom|react-router)(\/.*)?$/;

/** 이름 import 인가(상대·절대·스킴이 아닌 것). */
const isBare = (s: string): boolean => !s.startsWith('.') && !s.startsWith('/') && !s.includes(':');

/** 유닛 밖의 소스 파일인가(node_modules 안은 아니다 — 패키지끼리의 해석은 건드리지 않는다). */
function outsideApp(parentURL: string | undefined): boolean {
  if (parentURL === undefined || !parentURL.startsWith('file:')) return false;
  const file = fileURLToPath(parentURL);
  return !file.startsWith(APP_DIR) && !file.split(path.sep).includes('node_modules');
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // 가상 id → 확장 ui.ts.
    if (specifier === EXT_UI_ID) return { url: UI_URL, shortCircuit: true };
    if (!isBare(specifier) || !outsideApp(context.parentURL)) return nextResolve(specifier, context);
    // React 계열은 늘 이 앱 것.
    if (DEDUPE.test(specifier)) return nextResolve(specifier, { ...context, parentURL: APP_URL });
    // 그 밖은 제자리 먼저, 못 찾으면 이 앱 기준.
    try {
      return nextResolve(specifier, context);
    } catch {
      return nextResolve(specifier, { ...context, parentURL: APP_URL });
    }
  },
});
