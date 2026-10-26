// `GET /api/file?path=&src=` — 가운데 열 텍스트 파일 보기의 데이터. 본문은 JSON 문자열로만 낸다(HTML 로 내지 않는다).
// 경계는 /api/doc 과 같다: 조각 규칙(`..`·제외 폴더·private)을 소스를 열기 전에 보고, git 소스는 private 를 담지 않는다.
// local 은 디스크 경로 규칙(정식 경로·심링크) 그대로, git 소스는 리더(`cat-file blob`)로 읽는다.
import fs from 'node:fs';

import { segmentsBlocked } from '../shared/scope.ts';
import { parseSource } from '../shared/source.ts';
import { docChange, prChanges, type DocChange } from './changes.ts';
import { isFileInside, readSource, resolveDiskPath, type ApiResult, type Ctx } from './handlers.ts';
import { redactReason } from './source.ts';

/** 본문 상한(바이트). 넘으면 앞부분만 싣고 truncated 다. */
export const FILE_VIEW_LIMIT = 512 * 1024;

export type FileViewResponse = {
  path: string;
  /** 파일 전체 크기(바이트). */
  size: number;
  /** 본문(UTF-8). 바이너리면 빈 문자열이다. */
  text: string;
  truncated: boolean;
  binary: boolean;
  /** pr 소스면 이 파일의 변경(hunk). */
  change?: DocChange;
  /** pr 소스인데 변경 목록을 못 떴으면 그 까닭. */
  changeError?: string;
};

const fail = (status: number, error: string): ApiResult => ({ status, body: { error } });
const isErr = (v: unknown): v is ApiResult => typeof v === 'object' && v !== null && 'status' in v && 'body' in v;
const GIT_SCOPE = { includePrivate: false };

/** 디스크 파일의 앞 `limit + 1` 바이트와 전체 크기. 큰 파일을 통째로 읽지 않는다. */
function readHead(abs: string, limit: number): { head: Buffer; size: number } | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(abs, 'r');
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(size, limit + 1));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return { head: buf.subarray(0, n), size };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * 바이트를 본문으로. NUL 이 있거나 UTF-8 로 못 읽으면 바이너리다. 상한을 넘으면 상한에서 자르되
 * 여러 바이트 글자 가운데서 끊지 않게 이어지는 바이트(10xxxxxx)를 건너 앞으로 물린다.
 */
export function decodeText(bytes: Buffer, size: number, limit = FILE_VIEW_LIMIT): Pick<FileViewResponse, 'text' | 'truncated' | 'binary'> {
  const truncated = size > limit;
  let end = Math.min(bytes.length, limit);
  if (truncated) while (end > 0 && end > limit - 4 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
  const body = bytes.subarray(0, end);
  if (body.includes(0)) return { text: '', truncated, binary: true };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(body), truncated, binary: false };
  } catch {
    return { text: '', truncated, binary: true };
  }
}

export async function handleFile(ctx: Ctx, url: URL): Promise<ApiResult> {
  const rel = url.searchParams.get('path');
  if (rel === null || rel === '') return fail(404, 'path가 없다');
  const rawSrc = url.searchParams.get('src');
  const parsed = rawSrc === null ? null : parseSource(rawSrc);
  const gitSrc = parsed !== null && parsed.kind !== 'local';
  // 조각 규칙은 소스를 열기(fetch·gh) 전에 본다. git 소스는 private 를 담지 않는다.
  if (segmentsBlocked(rel.split('/'), gitSrc ? GIT_SCOPE : ctx)) return fail(404, `열 수 없는 경로다: ${rel}`);
  const s = await readSource(ctx, url);
  if (isErr(s)) return s;
  const { src, reader } = s;

  let bytes: Buffer;
  let size: number;
  if (src.kind === 'local') {
    const abs = resolveDiskPath(ctx, rel);
    if (abs === null) return fail(404, `열 수 없는 경로다: ${rel}`);
    if (!isFileInside(ctx.root, abs)) return fail(404, `파일이 없다: ${rel}`);
    const r = readHead(abs, FILE_VIEW_LIMIT);
    if (r === null) return fail(404, `파일을 읽지 못했다: ${rel}`);
    bytes = r.head;
    size = r.size;
  } else {
    const b = reader.readBytes(rel);
    if (b === null) return fail(404, `파일이 없다: ${rel}`);
    bytes = b;
    size = b.length;
  }

  let change: DocChange | undefined;
  let changeError: string | undefined;
  if (src.kind === 'pr') {
    const c = await prChanges(ctx.sources, ctx.root, src.number);
    if ('error' in c) {
      console.error(`[file] pr:${src.number} 변경 목록: ${c.error}`);
      changeError = redactReason(c.error);
    } else change = docChange(ctx.root, c, rel);
  }
  const body: FileViewResponse = {
    path: rel,
    size,
    ...decodeText(bytes, size),
    ...(change === undefined ? {} : { change }),
    ...(changeError === undefined ? {} : { changeError }),
  };
  return { status: 200, body };
}
