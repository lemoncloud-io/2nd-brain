// 앱 id 예약어 검사: 루트 클래스 `app-<id>` 가 뷰어 레이아웃 클래스(app-agent·app-left-collapsed …)와 겹치면 안 된다.
// 코어 시험(합성 id)과 확장 시험(실제 id)이 같이 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 뷰어가 이미 쓰는 `app-*` 클래스 접미. 스타일의 `.app-…` 와 화면 코드의 `'app-…'` 문자열을 모은다. `-` 로 끝나면 접두다. */
export function viewerAppClassSuffixes(): { exact: Set<string>; prefixes: string[] } {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));
  // src 아래 css·ts·tsx 를 모두 읽는다(앱 화면은 뷰어 src 밖이라 섞이지 않는다).
  for (const rel of fs.readdirSync(srcDir, { recursive: true }) as string[]) {
    if (!/\.(css|tsx?)$/.test(rel)) continue;
    const text = fs.readFileSync(path.join(srcDir, rel), 'utf8');
    const re = rel.endsWith('.css') ? /\.app-([a-z0-9-]+)/g : /['"`\s]app-([a-z0-9-]+)/g;
    for (const m of text.matchAll(re)) {
      if (m[1]!.endsWith('-')) prefixes.push(m[1]!);
      else exact.add(m[1]!);
    }
  }
  return { exact, prefixes };
}

/** 앱 id 가 뷰어 레이아웃 클래스와 겹치면 그 까닭, 아니면 null. */
export function reservedIdProblem(id: string, used: { exact: Set<string>; prefixes: string[] }): string | null {
  if (used.exact.has(id)) return `뷰어 클래스 app-${id} 와 겹친다`;
  const p = used.prefixes.find((x) => id.startsWith(x));
  return p === undefined ? null : `뷰어 클래스 접두 app-${p} 와 겹친다`;
}
