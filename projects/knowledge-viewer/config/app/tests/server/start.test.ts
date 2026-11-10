import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { appBuildSources, appsNeedingInstall, isStale, needsInstall, npmCommand } from '../../start.ts';

describe('needsInstall', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-install-'));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  function write(rel: string, sec: number): void {
    const f = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '{}');
    const t = new Date(sec * 1000);
    fs.utimesSync(f, t, t);
  }

  it('node_modules가 없으면 true', () => {
    write('package-lock.json', 1000);
    assert.equal(needsInstall(tmp), true);
  });

  it('설치 기록이 lock보다 새것이면 false', () => {
    write('package-lock.json', 1000);
    write('node_modules/.package-lock.json', 2000);
    assert.equal(needsInstall(tmp), false);
  });

  it('lock이 설치 기록보다 새것이면 true', () => {
    write('node_modules/.package-lock.json', 1000);
    write('package-lock.json', 2000);
    assert.equal(needsInstall(tmp), true);
  });

  it('설치 기록이 없으면 true', () => {
    write('package-lock.json', 1000);
    fs.mkdirSync(path.join(tmp, 'node_modules'));
    assert.equal(needsInstall(tmp), true);
  });

  it('lock이 없으면 node_modules가 있는 한 false', () => {
    fs.mkdirSync(path.join(tmp, 'node_modules'));
    assert.equal(needsInstall(tmp), false);
  });
});

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

describe('앱 폴더', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-apps-'));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  /** 폴더 하나에 파일을 쓰고 mtime 을 맞춘다. */
  function write(rel: string, sec: number): void {
    const f = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '{}');
    const t = new Date(sec * 1000);
    fs.utimesSync(f, t, t);
  }

  it('lockfile 이 있고 설치가 없거나 낡은 폴더만 npm ci 대상이다', () => {
    write('fresh/package-lock.json', 1000);
    write('fresh/node_modules/.package-lock.json', 2000);
    write('none/package-lock.json', 1000);
    write('stale/node_modules/.package-lock.json', 1000);
    write('stale/package-lock.json', 2000);
    write('nolock/package.json', 1000);
    const dirs = ['fresh', 'none', 'stale', 'nolock', 'missing'].map((d) => path.join(tmp, d));
    assert.deepEqual(appsNeedingInstall(dirs), [path.join(tmp, 'none'), path.join(tmp, 'stale')]);
    assert.deepEqual(appsNeedingInstall([]), []);
  });

  it('빌드 신선도 소스: 앱 src·package.json·lockfile, 그 src 가 새로우면 다시 빌드', () => {
    const app = path.join(tmp, 'app');
    assert.deepEqual(appBuildSources([app]), ['src', 'package.json', 'package-lock.json'].map((p) => path.join(app, p)));
    write('app/src/App.tsx', 1000);
    write('dist/index.html', 2000);
    assert.equal(isStale(path.join(tmp, 'dist'), appBuildSources([app])), false);
    write('app/src/App.tsx', 3000);
    assert.equal(isStale(path.join(tmp, 'dist'), appBuildSources([app])), true);
  });
});
