import { test } from 'node:test';
import assert from 'node:assert/strict';

import { frameOrigin, frameSrc, frameUrl, gitRawOrigin, isHtmlPath, rawHref, shouldHopToRaw } from '../../src/reader/frame.ts';

test('isHtmlPath: .html·.htm 만 참, 대소문자 무시', () => {
  assert.equal(isHtmlPath('a/b/index.html'), true);
  assert.equal(isHtmlPath('a/b/index.HTM'), true);
  assert.equal(isHtmlPath('a.md'), false);
  assert.equal(isHtmlPath('a.html.md'), false);
});

test('frameSrc: /raw/ + encodeURI(path) + hash 그대로', () => {
  assert.equal(
    frameSrc('projects/x/outputs/viewer/index.html', '#/p/overview'),
    '/raw/projects/x/outputs/viewer/index.html#/p/overview',
  );
  assert.equal(frameSrc('a b/한글.html', ''), '/raw/a%20b/%ED%95%9C%EA%B8%80.html');
});

test('rawHref: 출처를 붙인 절대 주소(frameUrl 과 같은 값)', () => {
  const origin = frameOrigin('127.0.0.1', '8778');
  assert.equal(rawHref(origin, 'a/b.html', '#x'), 'http://localhost:8778/raw/a/b.html#x');
  assert.equal(rawHref(origin, 'a/b.html', '#x'), frameUrl(origin, 'a/b.html', '#x'));
  assert.equal(rawHref(origin, 'a b/c#d.pdf', ''), 'http://localhost:8778/raw/a%20b/c%23d.pdf');
});

test('shouldHopToRaw: agent 이고 html 일 때만', () => {
  assert.equal(shouldHopToRaw({ path: 'a.html', anchor: '', agent: true, src: { kind: 'main' }, view: 'doc', graph: { depth: 2, mode: '3d', all: false } }), true);
  assert.equal(shouldHopToRaw({ path: 'a.html', anchor: '', agent: false, src: { kind: 'main' }, view: 'doc', graph: { depth: 2, mode: '3d', all: false } }), false);
  assert.equal(shouldHopToRaw({ path: 'a.md', anchor: '', agent: true, src: { kind: 'main' }, view: 'doc', graph: { depth: 2, mode: '3d', all: false } }), false);
});

test('frameOrigin: local·없음은 같은 포트 localhost', () => {
  assert.equal(frameOrigin('127.0.0.1', '8778'), 'http://localhost:8778');
  assert.equal(frameOrigin('localhost', '8778'), 'http://localhost:8778');
  assert.equal(frameOrigin('127.0.0.1', '8778', { kind: 'local' }, 9100), 'http://localhost:8778');
});

test('frameOrigin: main·pr 은 git 포트 localhost — info 의 gitRawPort, 없으면 port + 1', () => {
  assert.equal(frameOrigin('127.0.0.1', '8778', { kind: 'main' }), 'http://localhost:8779');
  assert.equal(frameOrigin('127.0.0.1', '8778', { kind: 'pr', number: 3 }), 'http://localhost:8779');
  assert.equal(frameOrigin('127.0.0.1', '8778', { kind: 'pr', number: 3 }, null), 'http://localhost:8779');
  assert.equal(frameOrigin('127.0.0.1', '8778', { kind: 'pr', number: 3 }, 9100), 'http://localhost:9100');
  assert.equal(frameOrigin('127.0.0.1', '8778', { kind: 'main' }, 9100), 'http://localhost:9100');
});

test('gitRawOrigin: 포트가 없으면(80) 81, 잘못된 gitRawPort 는 버린다', () => {
  assert.equal(gitRawOrigin('8778'), 'http://localhost:8779');
  assert.equal(gitRawOrigin('', null), 'http://localhost:81');
  assert.equal(gitRawOrigin('8778', 0), 'http://localhost:8779');
  assert.equal(gitRawOrigin('8778', 70000), 'http://localhost:8779');
  assert.equal(gitRawOrigin('8778', 8800), 'http://localhost:8800');
});

test('rawHref·frameUrl: git 소스 html 은 git 포트 출처의 /raw/@… 주소', () => {
  const pr = { kind: 'pr', number: 7 } as const;
  const origin = frameOrigin('127.0.0.1', '8778', pr, 8779);
  assert.equal(rawHref(origin, 'outputs/a.html', '#/x', pr), 'http://localhost:8779/raw/@pr/7/outputs/a.html#/x');
  assert.equal(frameUrl(frameOrigin('127.0.0.1', '8778', { kind: 'main' }), 'a.html', '', { kind: 'main' }), 'http://localhost:8779/raw/@main/a.html');
});

test('frameUrl: 출처 + frameSrc', () => {
  assert.equal(frameUrl('http://localhost:8778', 'a.html', '#/x'), 'http://localhost:8778/raw/a.html#/x');
});

test('frameSrc·rawHref·frameUrl: git 소스는 /raw/@main/·/raw/@pr/<n>/ 접두, local·없음은 접두 없음', () => {
  assert.equal(frameSrc('a.html', '#/x', { kind: 'pr', number: 1 }), '/raw/@pr/1/a.html#/x');
  assert.equal(frameSrc('a.html', '#/x', { kind: 'main' }), '/raw/@main/a.html#/x');
  assert.equal(frameSrc('a.html', '#/x', { kind: 'local' }), '/raw/a.html#/x');
  assert.equal(frameSrc('a.html', '#/x'), '/raw/a.html#/x');
  assert.equal(frameSrc('a b/c#d.html', '', { kind: 'pr', number: 42 }), '/raw/@pr/42/a%20b/c%23d.html');
  const origin = 'http://localhost:8778';
  assert.equal(rawHref(origin, 'a.html', '', { kind: 'pr', number: 7 }), 'http://localhost:8778/raw/@pr/7/a.html');
  assert.equal(frameUrl(origin, 'a.html', '#y', { kind: 'main' }), 'http://localhost:8778/raw/@main/a.html#y');
  assert.equal(rawHref(origin, 'a.html', '', { kind: 'local' }), 'http://localhost:8778/raw/a.html');
  // 디스크의 `@…` 경로는 소스 접두와 섞이지 않게 첫 `@` 를 부호화한다.
  assert.equal(frameSrc('@main/a.html', ''), '/raw/%40main/a.html');
  assert.equal(frameSrc('@x/a.html', '', { kind: 'main' }), '/raw/@main/%40x/a.html');
});
