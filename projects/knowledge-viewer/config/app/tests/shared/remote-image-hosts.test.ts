// 원격 이미지 허용 호스트 판정(shared/image-src.ts) — 순수 함수.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { httpsImage, isAllowedHost, normalizeHostEntry, parseHostList } from '../../shared/image-src.ts';

test('기본 허용 호스트는 확장 층이 준다 — 확장이 없으면 빈 목록', async () => {
  const { DEFAULT_REMOTE_IMAGE_HOSTS } = await import('../../src/ext/registry.ts');
  assert.deepEqual(DEFAULT_REMOTE_IMAGE_HOSTS, []);
});

test('isAllowedHost: 정확 일치, 대소문자·끝 점 무관', () => {
  const list = ['img.example.com', 'files.example.org'];
  assert.equal(isAllowedHost('img.example.com', list), true);
  assert.equal(isAllowedHost('IMG.Example.COM', list), true);
  assert.equal(isAllowedHost('img.example.com.', list), true);
  assert.equal(isAllowedHost('files.example.org', ['FILES.Example.Org']), true);
  assert.equal(isAllowedHost('miro.medium.com', list), false);
  assert.equal(isAllowedHost('', list), false);
  assert.equal(isAllowedHost('img.example.com', []), false);
});

test('isAllowedHost: 정확 일치 칸은 하위·상위·꼬리 붙은 호스트를 거절한다(오탐 없음)', () => {
  const list = ['img.example.com'];
  assert.equal(isAllowedHost('evil-img.example.com.attacker.com', list), false);
  assert.equal(isAllowedHost('img.example.com.attacker.com', list), false);
  assert.equal(isAllowedHost('evilimg.example.com', list), false);
  assert.equal(isAllowedHost('a.img.example.com', list), false);
  assert.equal(isAllowedHost('example.com', list), false);
});

test('isAllowedHost: *.도메인 은 하위 호스트만 — 도메인 자체·이름 꼬리 겹침은 아니다', () => {
  const list = ['*.googleusercontent.com'];
  assert.equal(isAllowedHost('lh7-rt.googleusercontent.com', list), true);
  assert.equal(isAllowedHost('a.b.googleusercontent.com', list), true);
  assert.equal(isAllowedHost('LH3.GoogleUserContent.com', list), true);
  assert.equal(isAllowedHost('googleusercontent.com', list), false);
  assert.equal(isAllowedHost('evilgoogleusercontent.com', list), false);
  assert.equal(isAllowedHost('lh7.googleusercontent.com.attacker.com', list), false);
});

test('isAllowedHost: 꼴이 아닌 칸(홀로 *·포트·경로·빈 값)은 아무것도 허용하지 않는다', () => {
  for (const bad of ['*', '*.', '*.com.', 'img.example.com:443', 'img.example.com/x', ' ', 'localhost']) {
    assert.equal(isAllowedHost('img.example.com', [bad]), false, bad);
  }
  assert.equal(isAllowedHost('localhost', ['localhost']), false);
});

test('normalizeHostEntry·parseHostList: 쉼표·공백·줄로 나누고 소문자·중복 제거·꼴 아닌 칸 버림', () => {
  assert.equal(normalizeHostEntry(' Img.Example.com. '), 'img.example.com');
  assert.equal(normalizeHostEntry('*.GoogleUserContent.com'), '*.googleusercontent.com');
  assert.equal(normalizeHostEntry('https://a.test'), null);
  assert.deepEqual(parseHostList('img.example.com, files.example.org\nMIRO.medium.com  img.example.com\n\n*\nbad/x'), [
    'img.example.com',
    'files.example.org',
    'miro.medium.com',
  ]);
  assert.deepEqual(parseHostList(''), []);
});

test('httpsImage: https 만 — http·//host·사용자 정보·못 읽는 주소는 null', () => {
  assert.deepEqual(httpsImage('https://img.example.com/abc'), { href: 'https://img.example.com/abc', host: 'img.example.com' });
  assert.deepEqual(httpsImage(' HTTPS://Img.Example.com/a b.png '), { href: 'https://img.example.com/a%20b.png', host: 'img.example.com' });
  assert.equal(httpsImage('http://img.example.com/abc'), null);
  assert.equal(httpsImage('//img.example.com/abc'), null);
  assert.equal(httpsImage('https://img.example.com@evil.test/a.png'), null);
  assert.equal(httpsImage('https://u:p@img.example.com/a.png'), null);
  assert.equal(httpsImage('https://'), null);
  assert.equal(httpsImage('javascript:alert(1)'), null);
  assert.equal(httpsImage('data:image/png;base64,AA'), null);
});
