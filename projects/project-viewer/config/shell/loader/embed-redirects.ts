// 볼트 뷰어 통합 보기(셸 컴포넌트를 다른 React 앱 안에 그리기)의 모듈 바꿔 끼우기 표. 순수 모듈이다.
// 셸 단독 빌드는 이 표를 쓰지 않는다 — 그래서 단독 산출물은 바이트 단위로 그대로다.
// 바꿔 끼우는 것은 "바깥과 닿는 자리"뿐이다: 데이터(가상 모듈), 라우트(해시), 테마, 원본 문서 주소,
// 그리고 전역 설정을 바깥 앱과 나눠 쓰는 mermaid.
// 화면 컴포넌트(App·blocks·reader)는 그대로 import 한다 — 복사하지 않으므로 셸에 새 블록이 생기면 통합 보기에도 따라온다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 셸 폴더(config/shell)의 절대경로. */
export const SHELL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 셸 화면 코드가 데이터를 받는 가상 모듈 이름(src/bundle.ts 가 부른다). */
export const BUNDLE_MODULE = 'virtual:viewer-bundle';

/** 이름으로 부르는 모듈(가상 모듈·패키지) → 어댑터. 셸 화면 코드가 부를 때만 바꾼다. */
export const BARE_REDIRECTS: Readonly<Record<string, string>> = {
  [BUNDLE_MODULE]: 'src/embed/bundle.ts',
  mermaid: 'src/embed/mermaid.ts',
};

/** 셸 상대경로: 원래 모듈 → 통합 보기용 어댑터. 어댑터는 원래 모듈과 같은 이름을 내보낸다. */
export const EMBED_REDIRECTS: Readonly<Record<string, string>> = {
  'src/app/useRoute.ts': 'src/embed/useRoute.ts',
  'src/app/theme.ts': 'src/embed/theme.ts',
  'src/app/router.ts': 'src/embed/router.ts',
};

/** 통합 보기 묶음이 쓰는 셸 CSS 폴더. 이 아래 파일만 루트 클래스 아래로 가둔다. */
export const SHELL_STYLES_DIR = path.join(SHELL_DIR, 'src', 'styles');

/** 셸 화면 코드(src/) 안이고 어댑터 폴더(src/embed/) 밖인가. 어댑터 자신은 원래 모듈을 그대로 불러야 한다. */
function isRedirectedImporter(importer: string): boolean {
  const rel = path.relative(SHELL_DIR, importer);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const parts = rel.split(path.sep);
  return parts[0] === 'src' && parts[1] !== 'embed';
}

/**
 * import 하나를 바꿔 끼울지 정한다. 바꾸면 어댑터의 절대경로, 아니면 null.
 * @param specifier import 문의 문자열(`./useRoute.ts`·`virtual:viewer-bundle`·`mermaid`)
 * @param importer 그 import 를 가진 파일의 절대경로(질의·해시는 떼고 준다)
 */
export function embedRedirect(specifier: string, importer: string | undefined): string | null {
  if (importer === undefined || !isRedirectedImporter(importer)) return null;
  const bare = BARE_REDIRECTS[specifier];
  if (bare !== undefined) return path.join(SHELL_DIR, bare);
  if (!specifier.startsWith('.')) return null;
  const target = path.resolve(path.dirname(importer), specifier);
  const rel = path.relative(SHELL_DIR, target).split(path.sep).join('/');
  const to = EMBED_REDIRECTS[rel];
  return to === undefined ? null : path.join(SHELL_DIR, to);
}

/** 셸 package.json 의 dependencies 이름. 통합 보기 묶음은 이것들을 바깥 앱의 한 벌로 맞춘다(React 두 벌 방지). */
export function shellDependencies(readText: (abs: string) => string): string[] {
  try {
    const pkg = JSON.parse(readText(path.join(SHELL_DIR, 'package.json'))) as { dependencies?: Record<string, string> };
    return Object.keys(pkg.dependencies ?? {}).sort();
  } catch {
    return [];
  }
}

/** 셸 CSS 파일(src/styles/*.css)인가. 질의(`?direct` 등)는 떼고 본다. */
export function isShellStyle(id: string): boolean {
  const file = id.split('?')[0]!;
  return file.endsWith('.css') && path.dirname(file) === SHELL_STYLES_DIR;
}
