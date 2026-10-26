// node --test 는 .tsx(JSX) 를 읽지 못한다. 이 파일을 먼저 불러오면 .tsx 를 esbuild(vite 의 의존성)로 바꿔 읽는다.
// 시험에서만 쓴다. .tsx 는 이 파일을 불러온 뒤 동적 import 로 불러와야 한다(정적 import 는 먼저 끌어올려진다).
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith('file:') || !url.endsWith('.tsx')) return nextLoad(url, context);
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
