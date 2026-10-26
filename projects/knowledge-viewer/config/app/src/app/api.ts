import { sourceKey } from '../../shared/source.ts';
import type { Source } from '../../shared/source.ts';
import type {
  DocResponse,
  GraphQuery,
  GraphResponse,
  LinkKind,
  PreviewResponse,
  PrChanges,
  PrFilesResponse,
  PrListResponse,
  PrReposResponse,
  ResolveResponse,
  SearchResponse,
  SearchScope,
  TitlesResponse,
  TreeResponse,
  VaultInfo,
} from './types.ts';
import type { FileResponse } from '../reader/file-lines.ts';

/** API 오류. 상태 코드를 함께 싣는다(404 로 폴백·지도의 없는 중심을 가르는 데 쓴다). */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // 본문이 JSON이 아니다. 아래에서 상태 코드로 오류를 만든다.
  }
  if (!res.ok) {
    const msg =
      typeof json === 'object' && json !== null && 'error' in json ? String((json as { error: unknown }).error) : `HTTP ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return json as T;
}

const q = (params: Record<string, string>): string => new URLSearchParams(params).toString();

// src 가 없으면 쿼리에 안 붙인다(API 기본은 local).
const srcQ = (src: Source | undefined): Record<string, string> => (src === undefined ? {} : { src: sourceKey(src) });

export const getTree = (dir: string, src?: Source): Promise<TreeResponse> => getJson(`/api/tree?${q({ dir, ...srcQ(src) })}`);
export const getDoc = (path: string, src?: Source): Promise<DocResponse> => getJson(`/api/doc?${q({ path, ...srcQ(src) })}`);
// 텍스트 파일 보기(md·html 밖). 본문은 JSON 문자열이다.
export const getFile = (path: string, src?: Source): Promise<FileResponse> => getJson(`/api/file?${q({ path, ...srcQ(src) })}`);
export const resolveLink = (link: string, kind: LinkKind, from: string, src?: Source): Promise<ResolveResponse> =>
  getJson(`/api/resolve?${q({ link, kind, from, ...srcQ(src) })}`);
export const getPreview = (path: string, anchor: string, src?: Source): Promise<PreviewResponse> =>
  getJson(`/api/preview?${q({ path, anchor, ...srcQ(src) })}`);
export const search = (query: string, scope: SearchScope): Promise<SearchResponse> =>
  getJson(`/api/search?${q({ q: query, scope })}`);
// 제목 목록은 디스크 색인 것이라 src 를 붙이지 않는다.
export const getTitles = (): Promise<TitlesResponse> => getJson('/api/titles');

// PR 패널. repo 가 null 이면 서버의 기본(허용 목록 첫 항목)이다.
const repoQ = (repo: string | null, refresh: boolean): Record<string, string> => ({
  ...(repo === null ? {} : { repo }),
  ...(refresh ? { refresh: '1' } : {}),
});
export const getPrRepos = (): Promise<PrReposResponse> => getJson('/api/panels/prs/repos');
export const getPrs = (repo: string | null, refresh: boolean): Promise<PrListResponse> => getJson(`/api/panels/prs?${q(repoQ(repo, refresh))}`);
export const getPrFiles = (repo: string | null, number: number, refresh: boolean): Promise<PrFilesResponse> =>
  getJson(`/api/panels/prs/files?${q({ ...repoQ(repo, refresh), number: String(number) })}`);

// PR 리뷰 모드: 볼트 레포 PR 이 바꾼 파일 목록(merge-base 기준).
export const getPrChanges = (n: number): Promise<PrChanges> => getJson(`/api/pr/${n}/changes`);

export const getInfo = (): Promise<VaultInfo> => getJson('/api/info');

// 지도. expand 는 쉼표로 잇는다(서버가 쉼표로 나눈다). 빈 목록이면 붙이지 않는다.
export const graphQueryString = (query: GraphQuery): string =>
  q({
    ...('all' in query
      ? { all: '1' }
      : {
          center: query.center,
          depth: String(query.depth),
          hubs: query.hubs,
          ...(query.expand.length > 0 ? { expand: query.expand.join(',') } : {}),
        }),
    ...(query.embed === undefined ? {} : { embed: query.embed }),
  });
export const getGraph = (query: GraphQuery): Promise<GraphResponse> => getJson(`/api/graph?${graphQueryString(query)}`);
