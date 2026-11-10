// node --test 는 .tsx(JSX) 를 읽지 못한다. 이 파일을 먼저 불러오면 .tsx 를 esbuild(vite 의 의존성)로 바꿔 읽는다.
// 시험에서만 쓴다. .tsx 는 이 파일을 불러온 뒤 동적 import 로 불러와야 한다(정적 import 는 먼저 끌어올려진다).
// project-viewer 셸 화면(통합 보기)도 Vite 플러그인과 같은 규칙으로 읽는다: 어댑터 바꿔 끼우기(embed-redirects.ts 의 표),
// 셸이 부르는 라이브러리는 이 앱의 한 벌(React 두 벌이면 훅이 깨진다), CSS import 는 빈 모듈.
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformSync } from 'esbuild';

import { SHELL_DIR, embedRedirect } from '../../../../../project-viewer/config/shell/loader/embed-redirects.ts';

const APP_URL = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..') + path.sep).href;
const SHELL_PREFIX = SHELL_DIR + path.sep;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL?.startsWith('file:') ? fileURLToPath(context.parentURL) : undefined;
    if (parent === undefined || !parent.startsWith(SHELL_PREFIX)) return nextResolve(specifier, context);
    // 셸 파일이 부르는 것: 어댑터로 바꿀 것은 바꾸고, 이름으로 부르는 패키지는 이 앱의 node_modules 에서 찾는다.
    const to = embedRedirect(specifier, parent);
    if (to !== null) return { url: pathToFileURL(to).href, shortCircuit: true };
    const bare = !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.includes(':');
    return bare ? nextResolve(specifier, { ...context, parentURL: APP_URL }) : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith('file:')) return nextLoad(url, context);
    // CSS 는 브라우저 묶음에서만 뜻이 있다.
    if (url.endsWith('.css')) return { format: 'module', source: 'export default "";', shortCircuit: true };
    if (!url.endsWith('.tsx')) return nextLoad(url, context);
    const file = fileURLToPath(url);
    const { code } = transformSync(fs.readFileSync(file, 'utf8'), {
      loader: 'tsx',
      jsx: 'automatic',
      format: 'esm',
      sourcefile: file,
    });
    return { format: 'module', source: code, shortCircuit: true };
  },
});
