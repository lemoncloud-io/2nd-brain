// 대상 프로젝트는 환경 변수 VIEWER_PROJECT로 받는다(절대경로 또는 cwd 기준).
// 산출물은 <프로젝트>/outputs/viewer/index.html 단일 파일이고 file://로 열려야 한다.
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

import { viewerData } from './loader/plugin.ts';

const SHELL_DIR = fileURLToPath(new URL('.', import.meta.url));

const target = process.env['VIEWER_PROJECT'];
if (!target) throw new Error('VIEWER_PROJECT가 없다. node cli.ts build <프로젝트 디렉터리>로 부른다.');
const projectDir = path.resolve(process.cwd(), target);

export default defineConfig({
  root: SHELL_DIR,
  base: './', // 산출물이 file://로 열려야 한다
  plugins: [viewerData(projectDir, { reposDir: process.env['VIEWER_REPOS_DIR'] }), react(), viteSingleFile()],
  build: {
    outDir: path.join(projectDir, 'outputs', 'viewer'),
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    sourcemap: false, // 절대경로가 산출물에 섞이지 않게 한다
  },
});
