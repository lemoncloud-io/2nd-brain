// `GET /api/resolve-paths?from=<문서>&src=<소스>&p=<후보>&p=…` — 본문 인라인 코드(`outputs/x.md` 등)가 지금 소스에 실제로 있는
// 볼트 경로인지 한 번에 묻는다(2026-10-27 오너 요청). 답은 JSON `{ source, from, paths: { [후보]: { path, kind } | null }, truncated? }`.
// 차례는 문서 폴더 기준 → 볼트 루트 기준(shared/code-path.ts). 경계는 /api/doc·/api/file 과 같다 — 조각 규칙(`..`·제외 폴더)을 보고,
// git 소스는 private 를 담지 않으며, local 은 디스크 경로 규칙(정식 경로·심링크) 그대로다. 있는 것만 답하고 내용은 읽지 않는다.
import fs from 'node:fs';

import {
  CODE_PATH_MAX_BATCH,
  codePathProbes,
  looksLikeFile,
  parseCodePath,
  parseProvenance,
  type CodePathHit,
  type ResolvePathsResponse,
} from '../shared/code-path.ts';
import { segmentsBlocked } from '../shared/scope.ts';
import { sourceKey, type Source } from '../shared/source.ts';
import { isFileInside, readSource, resolveDiskPath, type ApiResult, type Ctx } from './handlers.ts';
import type { SourceReader } from './source.ts';

const GIT_SCOPE = { includePrivate: false };
const isErr = (v: unknown): v is ApiResult => typeof v === 'object' && v !== null && 'status' in v && 'body' in v;

/** git 소스에서 `ls-tree` 로 폴더를 확인하는 횟수 상한(요청 하나). md 가 든 폴더는 spawn 없이 안다. */
export const FOLDER_PROBE_MAX = 24;

const kindOfFile = (p: string): CodePathHit['kind'] => (p.toLowerCase().endsWith('.md') ? 'md' : 'file');

/** 디스크(local): 있는 파일·폴더면 그 종류. 범위 밖·없음이면 null. */
function diskKind(ctx: Pick<Ctx, 'root' | 'includePrivate'>, rel: string): 'file' | 'folder' | null {
  const abs = resolveDiskPath(ctx, rel);
  if (abs === null) return null;
  try {
    if (fs.statSync(abs).isDirectory()) return 'folder';
  } catch {
    return null;
  }
  return isFileInside(ctx.root, abs) ? 'file' : null;
}

/**
 * 후보들을 지금 소스에서 찾는다. 같은 후보는 한 번만 본다. git 소스의 파일은 `ls-tree` 한 번(blobOids)으로,
 * 폴더는 md 목록(머리 oid 별 캐시)에서 먼저 보고 모자라면 FOLDER_PROBE_MAX 번까지 `list` 로 본다.
 */
export function resolveCodePaths(
  ctx: Pick<Ctx, 'root' | 'includePrivate'>,
  src: Source,
  reader: SourceReader,
  from: string,
  candidates: readonly string[],
): Record<string, CodePathHit | null> {
  const local = src.kind === 'local';
  const scope = local ? ctx : GIT_SCOPE;
  const plans = new Map<string, { probes: string[]; file: boolean; folder: boolean }>();
  for (const c of candidates) {
    if (plans.has(c)) continue;
    const cp = parseCodePath(c);
    if (cp === null) {
      // 출처 문자열(빈칸 든 원본 이름)은 볼트 루트 기준 그 경로 하나만 파일로 본다.
      const pv = parseProvenance(c);
      const probes = pv === null || segmentsBlocked(pv.split('/'), scope) ? [] : [pv];
      plans.set(c, { probes, file: true, folder: false });
      continue;
    }
    const probes = codePathProbes(from, cp.rel).filter((p) => !segmentsBlocked(p.split('/'), scope));
    // 끝 `/` 는 폴더만, 확장자가 있으면 파일만, 둘 다 아니면(`a/b`) 파일 다음 폴더.
    const file = !cp.folder;
    const folder = cp.folder || !looksLikeFile(cp.rel);
    plans.set(c, { probes, file, folder });
  }

  const out: Record<string, CodePathHit | null> = {};
  if (local) {
    for (const [c, plan] of plans) {
      out[c] = null;
      for (const p of plan.probes) {
        const k = diskKind(ctx, p);
        if (k === 'file' && plan.file) out[c] = { path: p, kind: kindOfFile(p) };
        else if (k === 'folder' && plan.folder) out[c] = { path: p, kind: 'folder' };
        if (out[c] !== null) break;
      }
    }
    return out;
  }

  // git 소스: 파일 후보 전부를 ls-tree 한 번에 묻는다(blobOids 가 없으면 하나씩).
  const fileProbes = [...new Set([...plans.values()].filter((pl) => pl.file).flatMap((pl) => pl.probes))];
  const blobs: Set<string> =
    reader.blobOids !== undefined ? new Set(reader.blobOids(fileProbes).keys()) : new Set(fileProbes.filter((p) => reader.exists(p)));
  let mdDirs: Set<string> | null = null;
  let folderProbes = 0;
  const folderExists = (p: string): boolean => {
    if (mdDirs === null) {
      mdDirs = new Set();
      for (const md of reader.listAll()) {
        const segs = md.split('/');
        for (let i = 1; i < segs.length; i++) mdDirs.add(segs.slice(0, i).join('/'));
      }
    }
    if (mdDirs.has(p)) return true;
    if (folderProbes >= FOLDER_PROBE_MAX) return false;
    folderProbes++;
    try {
      reader.list(p);
      return true;
    } catch {
      return false;
    }
  };
  for (const [c, plan] of plans) {
    out[c] = null;
    for (const p of plan.probes) {
      if (plan.file && blobs.has(p)) out[c] = { path: p, kind: kindOfFile(p) };
      else if (plan.folder && folderExists(p)) out[c] = { path: p, kind: 'folder' };
      if (out[c] !== null) break;
    }
  }
  return out;
}

export async function handleResolvePaths(ctx: Ctx, url: URL): Promise<ApiResult> {
  const from = url.searchParams.get('from') ?? '';
  const all = url.searchParams.getAll('p');
  const candidates = all.slice(0, CODE_PATH_MAX_BATCH);
  const s = await readSource(ctx, url);
  if (isErr(s)) return s;
  const body: ResolvePathsResponse = {
    source: sourceKey(s.src),
    from,
    paths: resolveCodePaths(ctx, s.src, s.reader, from, candidates),
    ...(all.length > candidates.length ? { truncated: true } : {}),
  };
  return { status: 200, body };
}
