// Vite 플러그인. 앱은 virtual:viewer-bundle 하나로만 데이터를 받는다.
// 원본은 빌드 때 읽어 가상 모듈로 주입하므로 디스크에 중간 생성물을 남기지 않는다.
import fs from 'node:fs';
import path from 'node:path';

import type { Plugin } from 'vite';

import type { Bundle } from '../model/index.ts';
import { CheckError, collect, readProjectGit } from './collect.ts';
import { findVaultRoot } from './vault.ts';
import type { GitInfo } from './stamp.ts';

const VIRTUAL = 'virtual:viewer-bundle';
const RESOLVED = `\0${VIRTUAL}`;
const MERMAID_STUB = '\0virtual:viewer-mermaid-stub';

export interface ViewerDataOptions {
  reposDir?: string;
  now?: () => Date;
  git?: GitInfo;
  /** 만들어진 Bundle을 밖에서 쓰고 싶을 때(빌드 요약 등). */
  onBundle?: (bundle: Bundle) => void;
}

/** 사람이 읽는 한 덩어리로 바꿔 빌드를 멈춘다. */
function fail(err: unknown): never {
  if (err instanceof CheckError) throw new Error(err.message);
  throw err;
}

export function viewerData(projectDir: string, options: ViewerDataOptions = {}): Plugin {
  const dir = path.resolve(projectDir);
  let cached: Bundle | null = null;
  let watched: string[] = [];

  const build = (): Bundle => {
    if (cached) return cached;
    const root = findVaultRoot(dir);
    let bundle: Bundle;
    try {
      bundle = collect({
        projectDir: dir,
        git: options.git ?? readProjectGit(dir),
        now: options.now ?? (() => new Date()),
        reposDir: options.reposDir,
      });
    } catch (err) {
      return fail(err);
    }
    watched = [
      path.join(dir, 'config', 'viewer.yml'),
      ...Object.values(bundle.docs)
        .filter((doc) => doc.repo === undefined)
        .map((doc) => path.join(root, doc.path)),
    ].filter((p) => fs.existsSync(p));
    cached = bundle;
    options.onBundle?.(bundle);
    return bundle;
  };

  /** mermaid 블록이 없으면 mermaid를 번들에 넣지 않는다 — 산출물이 가장 크게 줄어드는 자리다. */
  const usesMermaid = (): boolean =>
    build().viewer.pages.some((page) => page.blocks.some((block) => block.type === 'mermaid'));

  return {
    name: 'viewer-data',
    enforce: 'pre',

    resolveId(id) {
      if (id === VIRTUAL) return RESOLVED;
      if (id === 'mermaid' && !usesMermaid()) return MERMAID_STUB;
      return null;
    },

    load(id) {
      if (id === MERMAID_STUB) {
        return [
          '// 이 뷰어에는 mermaid 블록이 없어 실제 모듈을 넣지 않았다.',
          'const stub = {',
          '  initialize() {},',
          '  render() { throw new Error("mermaid는 이 뷰어에 포함되지 않았다"); },',
          '};',
          'export default stub;',
        ].join('\n');
      }
      if (id !== RESOLVED) return null;
      const bundle = build();
      for (const file of watched) this.addWatchFile(file);
      // JSON.parse가 객체 리터럴보다 빠르고, 따옴표 처리도 한 겹으로 끝난다.
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(bundle))});`;
    },

    configureServer(server) {
      const invalidate = (file: string): void => {
        if (!watched.includes(path.resolve(file))) return;
        cached = null;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('change', invalidate);
      server.watcher.on('add', invalidate);
      server.watcher.on('unlink', invalidate);
    },
  };
}
