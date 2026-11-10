// `GET /api/viewer-spec?path=&src=` — viewer.yml 보기의 데이터: 빌드 산출물이 이 소스에 있는지와 스펙보다 오래됐는지.
// 경계는 /api/file 과 같다: 조각 규칙(`..`·제외 폴더·private)을 소스를 열기 전에 보고, git 소스는 private 를 담지 않는다.
// 읽기만 한다 — 빌드하지 않는다(볼트에 쓰지 않는다).
// 시각: git 소스는 그 커밋에서 각 경로를 마지막으로 바꾼 커밋 시각이다. local 은 두 파일이 다 깨끗하면(git status 가 비면)
// HEAD 의 커밋 시각, 하나라도 고쳤거나 저장소가 아니면 디스크 mtime 이다 — 체크아웃은 mtime 을 체크아웃 순서로 찍어
// 깨끗한 파일끼리 mtime 을 견주면 거짓 "오래됨"이 나온다.
import fs from 'node:fs';

import { segmentsBlocked } from '../shared/scope.ts';
import { parseSource } from '../shared/source.ts';
import { isViewerSpecPath, viewerOutputOf, viewerProjectOf, type ViewerSpecResponse } from '../shared/viewer-spec.ts';
import { gitAsync, type GitAsyncFn } from './git.ts';
import { readSource, resolveDiskPath, type ApiResult, type Ctx } from './handlers.ts';

const fail = (status: number, error: string): ApiResult => ({ status, body: { error } });
const isErr = (v: unknown): v is ApiResult => typeof v === 'object' && v !== null && 'status' in v && 'body' in v;
const GIT_SCOPE = { includePrivate: false };

/** `rev` 에서 `rel` 을 마지막으로 바꾼 커밋 시각(ms). 모르면 null. */
async function commitTime(run: GitAsyncFn, root: string, rev: string, rel: string): Promise<number | null> {
  const r = await run(root, ['--literal-pathspecs', 'log', '-1', '--format=%ct', rev, '--', rel]);
  const s = Number(r.stdout.trim());
  return r.ok && r.stdout.trim() !== '' && Number.isFinite(s) ? s * 1000 : null;
}

function mtimeOf(ctx: Ctx, rel: string): number | null {
  const abs = resolveDiskPath(ctx, rel);
  if (abs === null) return null;
  try {
    return fs.statSync(abs).mtimeMs;
  } catch {
    return null;
  }
}

export async function handleViewerSpec(ctx: Ctx, url: URL, run: GitAsyncFn = gitAsync): Promise<ApiResult> {
  const rel = url.searchParams.get('path');
  if (rel === null || rel === '') return fail(404, 'path가 없다');
  if (!isViewerSpecPath(rel)) return fail(400, `viewer.yml 이 아니다: ${rel}`);
  const rawSrc = url.searchParams.get('src');
  const parsed = rawSrc === null ? null : parseSource(rawSrc);
  const scope = parsed !== null && parsed.kind !== 'local' ? GIT_SCOPE : ctx;
  if (segmentsBlocked(rel.split('/'), scope)) return fail(404, `열 수 없는 경로다: ${rel}`);
  const s = await readSource(ctx, url);
  if (isErr(s)) return s;
  const { src, reader } = s;
  if (!reader.exists(rel)) return fail(404, `파일이 없다: ${rel}`);

  const output = viewerOutputOf(rel);
  const exists = output !== null && !segmentsBlocked(output.split('/'), scope) && reader.exists(output);
  const body: ViewerSpecResponse = {
    spec: rel,
    project: viewerProjectOf(rel),
    output,
    exists,
    stale: null,
    basis: null,
    specTime: null,
    outputTime: null,
  };
  if (!exists || output === null) return { status: 200, body };

  let rev: string | null = null;
  if (src.kind !== 'local') {
    rev = reader.head ?? reader.ref;
  } else {
    const st = await run(ctx.root, ['--literal-pathspecs', 'status', '--porcelain', '--', rel, output]);
    if (st.ok && st.stdout.trim() === '') rev = 'HEAD';
  }
  if (rev !== null) {
    const [a, b] = await Promise.all([commitTime(run, ctx.root, rev, rel), commitTime(run, ctx.root, rev, output)]);
    body.basis = 'commit';
    body.specTime = a;
    body.outputTime = b;
  } else {
    body.basis = 'mtime';
    body.specTime = mtimeOf(ctx, rel);
    body.outputTime = mtimeOf(ctx, output);
  }
  if (body.specTime !== null && body.outputTime !== null) body.stale = body.outputTime < body.specTime;
  else body.basis = null;
  return { status: 200, body };
}
