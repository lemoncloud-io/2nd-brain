// imageMode(이미지 src 판정)와 resolveImageEmbed(위키 이미지 임베드의 볼트 경로).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { imageMode, isRawImagePath, resolveImageEmbed, stripQueryHash } from '../../shared/image-src.ts';

test('imageMode: data: 는 inline', () => {
  assert.equal(imageMode('data:image/png;base64,AAAA'), 'inline');
  assert.equal(imageMode(' DATA:image/gif;base64,R0'), 'inline');
});

test('imageMode: 원격(http·https·//host)은 badge-external', () => {
  for (const s of ['https://x.test/a.png', 'http://x.test/a.png', 'HTTPS://x.test/a.svg', '//cdn.test/a.png']) assert.equal(imageMode(s), 'badge-external', s);
});

test('imageMode: 볼트 상대경로 이미지는 raw — 확장자 7종, 대소문자 무관, 쿼리·해시는 경로가 아니다', () => {
  for (const s of ['a.png', './a.jpg', '../assets/a.jpeg', 'b/c.gif', 'x.webp', 'icon.svg', 'p.avif', 'A.PNG', 'b/C.SvG', 'a.png?v=1', 'a.png#x', '%EA%B7%B8%EB%A6%BC.png']) {
    assert.equal(imageMode(s), 'raw', s);
  }
});

test('imageMode: 절대경로·스킴·역슬래시·이미지 아닌 확장자·빈 값은 badge-relative', () => {
  for (const s of ['/etc/a.png', '/raw/a.png', 'file:///a.png', 'javascript:alert(1)//.png', 'vbscript:x.png', '\\\\host\\a.png', 'a.pdf', 'a', 'a.png.txt', '', '  ']) {
    assert.equal(imageMode(s), 'badge-relative', JSON.stringify(s));
  }
});

test('isRawImagePath·stripQueryHash', () => {
  assert.equal(stripQueryHash('a/b.png?x=1#y'), 'a/b.png');
  assert.equal(isRawImagePath('a/b.SVG'), true);
  assert.equal(isRawImagePath('a/.png'), false);
  assert.equal(isRawImagePath('a/b.md'), false);
});

const IMAGES = ['outputs/assets/trial/shot.png', 'wiki/shot.png', 'wiki/sub/deep/shot.png', 'projects/a/Fig.PNG', 'raw/assets/clip.jpg'];

test('resolveImageEmbed: 파일명만 — 같은 폴더 → / 수 → 알파벳', () => {
  assert.equal(resolveImageEmbed('wiki/doc.md', 'shot.png', IMAGES), 'wiki/shot.png');
  assert.equal(resolveImageEmbed('projects/x/doc.md', 'shot.png', IMAGES), 'wiki/shot.png');
  assert.equal(resolveImageEmbed('outputs/assets/trial/doc.md', 'shot.png', IMAGES), 'outputs/assets/trial/shot.png');
});

test('resolveImageEmbed: 경로 꼬리·대소문자 무관·앞 ./ 와 / 무시', () => {
  assert.equal(resolveImageEmbed('wiki/doc.md', 'deep/shot.png', IMAGES), 'wiki/sub/deep/shot.png');
  assert.equal(resolveImageEmbed('wiki/doc.md', 'fig.png', IMAGES), 'projects/a/Fig.PNG');
  assert.equal(resolveImageEmbed('wiki/doc.md', './trial/shot.png', IMAGES), 'outputs/assets/trial/shot.png');
  assert.equal(resolveImageEmbed('wiki/doc.md', '/raw/assets/clip.jpg', IMAGES), 'raw/assets/clip.jpg');
});

test('resolveImageEmbed: 없음·이미지 아님·스킴·.. 은 null', () => {
  assert.equal(resolveImageEmbed('wiki/doc.md', 'none.png', IMAGES), null);
  assert.equal(resolveImageEmbed('wiki/doc.md', 'shot.md', IMAGES), null);
  assert.equal(resolveImageEmbed('wiki/doc.md', 'https://x.test/shot.png', IMAGES), null);
  assert.equal(resolveImageEmbed('wiki/doc.md', '../wiki/shot.png', IMAGES), null);
  // 꼬리는 조각 단위다: `hot.png` 는 `shot.png` 가 아니다.
  assert.equal(resolveImageEmbed('wiki/doc.md', 'hot.png', IMAGES), null);
});
