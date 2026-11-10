// 없는 문서·폴더에서 떨어질 곳: 그 소스에 실제로 있는 가장 가까운 상위 폴더(없으면 루트). 서버 없이 목록 함수로 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ApiError } from '../../src/app/api.ts';
import { isNotFound, nearestFolder, parentDir } from '../../src/app/missing-fallback.ts';

/** 있는 폴더만 목록을 돌려주고 나머지는 404 를 던지는 가짜 목록. 요청한 폴더를 차례로 적는다. */
function fakeList(existing: string[]) {
  const asked: string[] = [];
  const list = async (dir: string): Promise<string> => {
    asked.push(dir);
    if (existing.includes(dir)) return `list:${dir}`;
    throw new ApiError(`없음: ${dir}`, 404);
  };
  return { asked, list };
}

test('parentDir: 한 층 위, 루트의 위는 없다', () => {
  assert.equal(parentDir('a/b/c'), 'a/b');
  assert.equal(parentDir('a'), '');
  assert.equal(parentDir(''), null);
});

test('isNotFound: 404 ApiError 만 참', () => {
  assert.equal(isNotFound(new ApiError('x', 404)), true);
  assert.equal(isNotFound(new ApiError('x', 500)), false);
  assert.equal(isNotFound(new Error('x')), false);
});

test('nearestFolder: 없는 문서의 폴더가 있으면 거기서 멈춘다(요청 한 번)', async () => {
  const { asked, list } = fakeList(['', 'p', 'p/app', 'p/app/pair']);
  assert.deepEqual(await nearestFolder('p/app/pair', list), { dir: 'p/app/pair', listing: 'list:p/app/pair' });
  assert.deepEqual(asked, ['p/app/pair']);
});

test('nearestFolder: 폴더가 없고 윗 폴더가 있으면 윗 폴더(층마다 한 번)', async () => {
  const { asked, list } = fakeList(['', 'p', 'p/app']);
  assert.deepEqual(await nearestFolder('p/app/pair', list), { dir: 'p/app', listing: 'list:p/app' });
  assert.deepEqual(asked, ['p/app/pair', 'p/app']);
});

test('nearestFolder: 루트만 있으면 루트, 루트도 없으면 목록 없이 루트에 선다(루트 위로 안 간다)', async () => {
  const onlyRoot = fakeList(['']);
  assert.deepEqual(await nearestFolder('a/b', onlyRoot.list), { dir: '', listing: 'list:' });
  assert.deepEqual(onlyRoot.asked, ['a/b', 'a', '']);
  const none = fakeList([]);
  assert.deepEqual(await nearestFolder('a/b', none.list), { dir: '', listing: null });
  assert.deepEqual(none.asked, ['a/b', 'a', '']);
  const fromRoot = fakeList([]);
  assert.deepEqual(await nearestFolder('', fromRoot.list), { dir: '', listing: null });
  assert.deepEqual(fromRoot.asked, ['']);
});

test('nearestFolder: 404 밖의 오류는 삼키지 않고 던진다', async () => {
  const asked: string[] = [];
  const list = async (dir: string): Promise<string> => {
    asked.push(dir);
    if (dir === 'a/b') throw new ApiError('없음', 404);
    throw new ApiError('gh 실패', 502);
  };
  await assert.rejects(nearestFolder('a/b', list), (e: unknown) => e instanceof ApiError && e.status === 502);
  assert.deepEqual(asked, ['a/b', 'a']);
});

test('nearestFolder: 주소가 바뀌면(alive 거짓) 다음 층으로 가지 않고 null', async () => {
  let live = true;
  const asked: string[] = [];
  const list = async (dir: string): Promise<string> => {
    asked.push(dir);
    live = false;
    throw new ApiError('없음', 404);
  };
  assert.equal(await nearestFolder('a/b', list, () => live), null);
  assert.deepEqual(asked, ['a/b']);
  // 찾았어도 그새 주소가 바뀌었으면 버린다.
  let alive = true;
  const found = async (dir: string): Promise<string> => {
    alive = false;
    return dir;
  };
  assert.equal(await nearestFolder('a', found, () => alive), null);
});
