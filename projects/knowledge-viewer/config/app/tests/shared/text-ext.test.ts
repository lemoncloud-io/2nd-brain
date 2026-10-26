// 텍스트 파일 보기 대상 판정(트리 링크).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isTextPath } from '../../shared/text-ext.ts';

test('isTextPath: 코드·설정·글 확장자와 이름은 참, md·html·이미지·확장자 없음은 거짓', () => {
  for (const p of ['a/b.ts', 'x.TSX', 'c.json', 'd.yml', 'e.YAML', 'f.py', 'g.css', 'h.sh', 'i.toml', 'j.txt', 'k/Makefile', 'Dockerfile', 'l.csv']) {
    assert.equal(isTextPath(p), true, p);
  }
  for (const p of ['a.md', 'b.html', 'c.htm', 'd.png', 'e.pdf', 'f.svg', 'g', 'dir/noext', '.env', 'h.ts/']) {
    assert.equal(isTextPath(p), false, p);
  }
});
