// 가운데 열의 텍스트 파일 보기로 여는 경로인가. 순수 모듈이다 — 트리 링크가 쓴다.
// md·html 은 각자 화면(리더·iframe)이 있어 여기 넣지 않는다. 목록 밖 파일도 /api/file 은 읽는다(바이너리면 안내만).

/** 텍스트로 보는 확장자(소문자, 점 없이). */
export const TEXT_EXTS: ReadonlySet<string> = new Set([
  // 코드
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'py', 'sh', 'bash', 'zsh', 'fish', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'lua', 'pl', 'r', 'sql', 'graphql', 'proto', 'vue', 'svelte', 'astro',
  // 스타일
  'css', 'scss', 'less',
  // 설정·데이터
  'json', 'jsonc', 'jsonl', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties', 'xml', 'csv', 'tsv', 'lock',
  // 글
  'txt', 'log', 'rst', 'adoc', 'tex', 'mdx', 'diff', 'patch',
]);

/** 확장자 없이도 텍스트인 파일 이름. */
const TEXT_NAMES: ReadonlySet<string> = new Set(['makefile', 'dockerfile', 'license', 'readme', 'procfile', 'gemfile', 'brewfile']);

/** 경로가 텍스트 파일 보기 대상인가. md·html 은 false 다. */
export function isTextPath(path: string): boolean {
  const name = (path.split('/').pop() ?? '').toLowerCase();
  if (TEXT_NAMES.has(name)) return true;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return false;
  return TEXT_EXTS.has(name.slice(dot + 1));
}
