// 원격 이미지 허용 호스트 판정(shared/image-src.ts) — 순수 함수.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_REMOTE_IMAGE_HOSTS, httpsImage, isAllowedHost, normalizeHostEntry, parseHostList } from '../../shared/image-src.ts';

test('기본 허용 호스트는 조직 CDN 둘이다', () => {
  assert.deepEqual(DEFAULT_REMOTE_IMAGE_HOSTS, ['image.lemoncloud.io', 'file.eureka.codes']);
});

test('isAllowedHost: 정확 일치, 대소문자·끝 점 무관', () => {
  const list = ['image.lemoncloud.io', 'file.eureka.codes'];
  assert.equal(isAllowedHost('image.lemoncloud.io', list), true);
  assert.equal(isAllowedHost('IMAGE.LemonCloud.IO', list), true);
  assert.equal(isAllowedHost('image.lemoncloud.io.', list), true);
  assert.equal(isAllowedHost('file.eureka.codes', ['FILE.Eureka.Codes']), true);
  assert.equal(isAllowedHost('miro.medium.com', list), false);
  assert.equal(isAllowedHost('', list), false);
  assert.equal(isAllowedHost('image.lemoncloud.io', []), false);
});

test('isAllowedHost: 정확 일치 칸은 하위·상위·꼬리 붙은 호스트를 거절한다(오탐 없음)', () => {
  const list = ['image.lemoncloud.io'];
  assert.equal(isAllowedHost('evil-image.lemoncloud.io.attacker.com', list), false);
  assert.equal(isAllowedHost('image.lemoncloud.io.attacker.com', list), false);
  assert.equal(isAllowedHost('evilimage.lemoncloud.io', list), false);
  assert.equal(isAllowedHost('a.image.lemoncloud.io', list), false);
  assert.equal(isAllowedHost('lemoncloud.io', list), false);
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
  for (const bad of ['*', '*.', '*.com.', 'image.lemoncloud.io:443', 'image.lemoncloud.io/x', ' ', 'localhost']) {
    assert.equal(isAllowedHost('image.lemoncloud.io', [bad]), false, bad);
  }
  assert.equal(isAllowedHost('localhost', ['localhost']), false);
});

test('normalizeHostEntry·parseHostList: 쉼표·공백·줄로 나누고 소문자·중복 제거·꼴 아닌 칸 버림', () => {
  assert.equal(normalizeHostEntry(' Image.LemonCloud.io. '), 'image.lemoncloud.io');
  assert.equal(normalizeHostEntry('*.GoogleUserContent.com'), '*.googleusercontent.com');
  assert.equal(normalizeHostEntry('https://a.test'), null);
  assert.deepEqual(parseHostList('image.lemoncloud.io, file.eureka.codes\nMIRO.medium.com  image.lemoncloud.io\n\n*\nbad/x'), [
    'image.lemoncloud.io',
    'file.eureka.codes',
    'miro.medium.com',
  ]);
  assert.deepEqual(parseHostList(''), []);
});

test('httpsImage: https 만 — http·//host·사용자 정보·못 읽는 주소는 null', () => {
  assert.deepEqual(httpsImage('https://image.lemoncloud.io/abc'), { href: 'https://image.lemoncloud.io/abc', host: 'image.lemoncloud.io' });
  assert.deepEqual(httpsImage(' HTTPS://Image.LemonCloud.io/a b.png '), { href: 'https://image.lemoncloud.io/a%20b.png', host: 'image.lemoncloud.io' });
  assert.equal(httpsImage('http://image.lemoncloud.io/abc'), null);
  assert.equal(httpsImage('//image.lemoncloud.io/abc'), null);
  assert.equal(httpsImage('https://image.lemoncloud.io@evil.test/a.png'), null);
  assert.equal(httpsImage('https://u:p@image.lemoncloud.io/a.png'), null);
  assert.equal(httpsImage('https://'), null);
  assert.equal(httpsImage('javascript:alert(1)'), null);
  assert.equal(httpsImage('data:image/png;base64,AA'), null);
});
