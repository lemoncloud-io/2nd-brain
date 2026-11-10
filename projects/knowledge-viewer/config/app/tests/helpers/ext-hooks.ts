// 유닛 시험의 확장 해석: 화면 확장 가상 모듈을 늘 빈 모듈로 푼다(`node --import` 로 먼저 불린다).
// 그래서 유닛 시험은 볼트의 확장 상태와 무관하게 결정적이다. 확장을 실어 보는 시험은 ext-hooks-vault.ts 를 쓴다.
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

import { EMPTY_UI_FILE, EXT_UI_ID } from '../../ext-locate.ts';

registerHooks({
  // 가상 id 만 바꾼다. 그 밖은 기본 해석.
  resolve(specifier, context, nextResolve) {
    if (specifier === EXT_UI_ID) return { url: pathToFileURL(EMPTY_UI_FILE).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
