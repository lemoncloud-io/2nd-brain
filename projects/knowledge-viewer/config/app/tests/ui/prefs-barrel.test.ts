// prefs.ts 는 묶음 파일이다 — 다시 내보내기만 있고 함수가 없어야 한다.
// 까닭: 여러 PR 이 같은 파일 끝에 함수를 덧붙이면 같은 자리에서 충돌한다(2026-10-23 #939·#940).
// 설정은 prefs/<기능>.ts 에 두고, 묶음 파일은 한 줄만 더한다(그 한 줄도 기능마다 다른 자리가 아니라
// 끝에 붙지만, 한 줄짜리 `export *` 충돌은 양쪽을 다 두면 끝나는 자명한 충돌이다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BARREL = path.resolve(here, '../../src/app/prefs.ts');

test('src/app/prefs.ts 는 주석과 export … from 줄만 가진다', () => {
  const lines = fs
    .readFileSync(BARREL, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('//'));
  assert.ok(lines.length > 0, '빈 묶음 파일');
  for (const l of lines) {
    assert.match(l, /^export (\*|\{[^}]*\}|type \{[^}]*\}) from '\.\/prefs\/[a-z-]+\.ts';$/, `묶음 파일에 허용되지 않는 줄: ${l}`);
  }
});

test('묶음 파일이 가리키는 기능 파일이 모두 있다', () => {
  const src = fs.readFileSync(BARREL, 'utf8');
  const targets = [...src.matchAll(/from '\.\/(prefs\/[a-z-]+\.ts)'/g)].map((m) => m[1]!);
  assert.ok(targets.length >= 3);
  for (const t of targets) assert.ok(fs.existsSync(path.resolve(here, '../../src/app', t)), `없는 파일: ${t}`);
});
