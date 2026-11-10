// `GET /api/project-viewer?path=<viewer.yml>&src=` — viewer.yml 하나를 project-viewer 셸의 model·loader(collect)로
// 메모리에서 묶어(Bundle) 돌려준다. 볼트에 쓰지 않는다 — 빌드 파일도 만들지 않는다.
// 경계는 /api/file·/api/viewer-spec 과 같다: 조각 규칙(`..`·제외 폴더·private)을 소스를 열기 전에 보고, 원본 하나하나도
// 같은 규칙으로 거른 뒤 그 소스의 리더로 읽는다(local 은 디스크, main·pr 은 git — git 소스는 private 를 담지 않는다).
// 셸 모듈은 처음 요청 때 불러온다 — 셸 의존성(그 폴더의 node_modules)이 없으면 이 경로만 503 이고 서버는 산다.
// 결과는 메모리에 둔다. 키는 소스 + 경로, 맞는지는 입력(viewer.yml + 읽은 원본)의 내용 지문과 머리 커밋으로 본다.
import { createHash } from 'node:crypto';

import { segmentsBlocked } from '../shared/scope.ts';
import { parseSource, sourceKey } from '../shared/source.ts';
import { SHELL_PATH, type ProjectViewerResponse } from '../shared/project-viewer.ts';
import { isViewerSpecPath } from '../shared/viewer-spec.ts';
import { readSource, type ApiResult, type Ctx } from './handlers.ts';
import type { SourceReader } from './source.ts';

type CollectModule = typeof import('../../../../project-viewer/config/shell/loader/collect.ts');
type StampModule = typeof import('../../../../project-viewer/config/shell/loader/stamp.ts');

/** 셸 loader 에서 쓰는 것. 시험은 이 자리를 가짜로 바꿀 수 있다. */
export type ShellLoader = { collect: CollectModule['collect']; CheckError: CollectModule['CheckError']; readGit: StampModule['readGit'] };

const fail = (status: number, error: string): ApiResult => ({ status, body: { error } });
const isErr = (v: unknown): v is ApiResult => typeof v === 'object' && v !== null && 'status' in v && 'body' in v;
const GIT_SCOPE = { includePrivate: false };

let shellLoading: Promise<ShellLoader> | null = null;

/** 셸 loader 를 한 번 불러온다. 실패하면 다음 요청이 다시 시도한다(npm ci 뒤 서버를 다시 켜지 않아도 되게). */
export function loadShell(): Promise<ShellLoader> {
  shellLoading ??= Promise.all([
    import('../../../../project-viewer/config/shell/loader/collect.ts'),
    import('../../../../project-viewer/config/shell/loader/stamp.ts'),
  ]).then(
    ([c, s]) => ({ collect: c.collect, CheckError: c.CheckError, readGit: s.readGit }),
    (e: unknown) => {
      shellLoading = null;
      throw e;
    },
  );
  return shellLoading;
}

type Entry = { ver: string | null; digest: string; inputs: string[]; body: ProjectViewerResponse };
const CACHE_MAX = 16;
const cache = new Map<string, Entry>();

/** 시험용: 메모리 캐시를 비운다. */
export function clearProjectViewerCache(): void {
  cache.clear();
}

/** 읽은 입력(경로 → 본문, 없으면 null)의 지문. 경로 순서에 무관하다. */
function digestOf(inputs: Map<string, string | null>): string {
  const h = createHash('sha256');
  for (const p of [...inputs.keys()].sort()) {
    const text = inputs.get(p);
    h.update(p).update('\0').update(text === null || text === undefined ? '\u0001' : `\u0002${text}`).update('\0');
  }
  return h.digest('hex');
}

/** 같은 소스에서 다시 읽어 지문이 같은가. */
function sameInputs(entry: Entry, read: (p: string) => string | null): boolean {
  const now = new Map<string, string | null>();
  for (const p of entry.inputs) now.set(p, read(p));
  return digestOf(now) === entry.digest;
}

/** 소스의 머리 커밋. local 은 HEAD, git 소스는 실제로 읽는 커밋. 모르면 null. */
function versionOf(reader: SourceReader): string | null {
  return reader.commit ?? reader.head ?? null;
}

export async function handleProjectViewer(ctx: Ctx, url: URL, load: () => Promise<ShellLoader> = loadShell): Promise<ApiResult> {
  const rel = url.searchParams.get('path');
  if (rel === null || rel === '') return fail(404, 'path가 없다');
  if (!isViewerSpecPath(rel)) return fail(400, `viewer.yml 이 아니다: ${rel}`);
  const rawSrc = url.searchParams.get('src');
  const parsed = rawSrc === null ? null : parseSource(rawSrc);
  const scope = parsed !== null && parsed.kind !== 'local' ? GIT_SCOPE : ctx;
  // 조각 규칙은 소스를 열기(fetch·gh) 전에 본다.
  if (segmentsBlocked(rel.split('/'), scope)) return fail(404, `열 수 없는 경로다: ${rel}`);
  const s = await readSource(ctx, url);
  if (isErr(s)) return s;
  const { src, reader } = s;
  const viewerText = reader.readText(rel);
  if (viewerText === null) return fail(404, `파일이 없다: ${rel}`);

  let shell: ShellLoader;
  try {
    shell = await load();
  } catch (e) {
    console.error(`[project-viewer] 셸을 불러오지 못했다: ${e instanceof Error ? e.message : String(e)}`);
    return fail(503, `project-viewer 셸을 불러오지 못했다 — 셸 의존성이 없을 수 있다: (cd ${SHELL_PATH} && npm ci)`);
  }

  // 원본 읽기: 경계 밖(private·제외 폴더·`..`)은 없는 파일로 본다. 같은 소스의 리더로 읽는다.
  const read = (p: string): string | null => (p === '' || segmentsBlocked(p.split('/'), scope) ? null : reader.readText(p));
  const key = `${sourceKey(src)}\0${rel}`;
  const ver = versionOf(reader);
  const hit = cache.get(key);
  // git 소스는 커밋이 같으면 내용도 같다. local 은 머리가 같아도 작업 트리가 바뀌었을 수 있어 다시 읽어 견준다.
  if (hit !== undefined && hit.ver === ver && (src.kind !== 'local' || sameInputs(hit, read))) {
    cache.delete(key);
    cache.set(key, hit);
    return { status: 200, body: hit.body };
  }

  const inputs = new Map<string, string | null>([[rel, viewerText]]);
  const recorded = (p: string): string | null => {
    const text = read(p);
    inputs.set(p, text);
    return text;
  };
  let body: ProjectViewerResponse;
  try {
    // 커밋·dirty 는 원본을 다 읽은 뒤 셸의 readGit 으로 채운다(아래). 시각은 셸 스탬프 그대로 지금이다.
    const bundle = shell.collect({ projectDir: '', git: { commit: null, dirty: false }, now: () => new Date(), viewerText, readFile: recorded });
    const git =
      src.kind === 'local'
        ? shell.readGit(ctx.root, { paths: [...inputs].filter(([, text]) => text !== null).map(([p]) => p) })
        : { commit: ver === null ? null : ver.slice(0, 8), dirty: false };
    bundle.stamp.commit = git.commit;
    bundle.stamp.dirty = git.dirty;
    body = { ok: true, spec: rel, bundle };
  } catch (e) {
    if (e instanceof shell.CheckError) {
      body = { ok: false, spec: rel, issues: e.issues };
    } else {
      console.error(`[project-viewer] ${rel}: ${e instanceof Error ? e.message : String(e)}`);
      return fail(500, `viewer.yml 을 묶지 못했다: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  cache.delete(key);
  cache.set(key, { ver, digest: digestOf(inputs), inputs: [...inputs.keys()], body });
  // 오래 안 쓴 것부터 버린다.
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return { status: 200, body };
}
