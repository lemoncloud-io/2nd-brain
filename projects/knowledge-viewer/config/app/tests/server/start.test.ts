import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isStale, npmCommand } from '../../start.ts';

describe('npmCommand', () => {
  it('Windows는 셸로 한 줄 명령을 실행한다', () => {
    assert.deepEqual(npmCommand(['run', 'build'], 'win32'), { file: 'npm run build', args: [], shell: true });
  });

  it('그 밖의 플랫폼은 셸 없이 npm을 실행한다', () => {
    assert.deepEqual(npmCommand(['ci'], 'darwin'), { file: 'npm', args: ['ci'], shell: false });
    assert.deepEqual(npmCommand(['ci'], 'linux'), { file: 'npm', args: ['ci'], shell: false });
  });
});

describe('isStale', () => {
  let tmp: string;
  let dist: string;
  let src: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-start-'));
    dist = path.join(tmp, 'dist');
    src = path.join(tmp, 'src');
    fs.mkdirSync(path.join(src, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(src, 'nested', 'a.ts'), 'x');
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  function touch(file: string, sec: number): void {
    const t = new Date(sec * 1000);
    fs.utimesSync(file, t, t);
  }
  function writeDist(sec: number): void {
    fs.mkdirSync(dist, { recursive: true });
    const f = path.join(dist, 'index.html');
    fs.writeFileSync(f, '<html></html>');
    touch(f, sec);
  }

  it('dist/index.html이 없으면 true', () => {
    assert.equal(isStale(dist, [src]), true);
  });

  it('dist/index.html이 소스보다 새것이면 false', () => {
    touch(path.join(src, 'nested', 'a.ts'), 1000);
    writeDist(2000);
    assert.equal(isStale(dist, [src]), false);
  });

  it('소스 파일을 나중 mtime으로 touch하면 true', () => {
    touch(path.join(src, 'nested', 'a.ts'), 1000);
    writeDist(2000);
    touch(path.join(src, 'nested', 'a.ts'), 3000);
    assert.equal(isStale(dist, [src]), true);
  });

  it('srcDirs에 든 파일 경로는 그 자체로 본다', () => {
    const f = path.join(tmp, 'vite.config.ts');
    fs.writeFileSync(f, 'x');
    touch(path.join(src, 'nested', 'a.ts'), 1000);
    touch(f, 3000);
    writeDist(2000);
    assert.equal(isStale(dist, [src, f]), true);
  });

  it('없는 경로와 node_modules는 건너뛴다', () => {
    touch(path.join(src, 'nested', 'a.ts'), 1000);
    fs.mkdirSync(path.join(src, 'node_modules'));
    const nm = path.join(src, 'node_modules', 'b.js');
    fs.writeFileSync(nm, 'x');
    touch(nm, 5000);
    writeDist(2000);
    assert.equal(isStale(dist, [src, path.join(tmp, 'missing')]), false);
  });
});
