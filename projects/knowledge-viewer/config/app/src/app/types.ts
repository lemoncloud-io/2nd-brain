// 서버 응답의 화면 쪽 거울. 정본은 server/handlers.ts다.
import type { DocEmbed as SharedDocEmbed } from '../../shared/embeds.ts';
import type { Kind } from '../../shared/kind.ts';
import type { Source } from '../../shared/source.ts';
import type { Entry, Heading } from '../../shared/types.ts';

export type { Entry, Heading, Kind, Source };

export type TreeEntry = Entry & { title?: string };
export type TreeResponse = { dir: string; entries: TreeEntry[] };

export type LinkKind = 'wiki' | 'md';

/** `extractLinks`의 LinkRef에 `index.resolve()`의 결과(path·candidates)를 덧붙인 형. */
export type DocLink = {
  kind: LinkKind;
  target: string;
  anchor: string | null;
  label: string;
  line: number;
  embed: boolean;
  /** 해석된 문서 경로. 해석 못 하면 null이다. */
  path: string | null;
  /** 같은 이름 문서가 둘 이상일 때 후보 전부(path가 그중 우선 하나). 아니면 빈 배열이다. */
  candidates: string[];
};

/** `/api/doc` 의 `embeds[key]`(노트 임베드 1단계). 정본은 shared/embeds.ts · server/embeds.ts 다. */
export type DocEmbed = SharedDocEmbed<DocLink>;

/** 이 문서를 가리키는 문서 하나. count 는 그 문서 안의 링크 수다. */
export type Backlink = { path: string; title: string; count: number };

// PR 변경. 정본은 server/changes.ts 다. 줄 번호는 파일 전체 기준(frontmatter 포함)이다.
export type ChangedFile = { path: string; status: 'A' | 'M' | 'D' | 'R'; from?: string };
export type DocChange = {
  status: ChangedFile['status'] | null;
  hunks: { start: number; end: number }[];
  removed: { afterLine: number; count: number }[];
  added: number;
  deleted: number;
};
export type PrChanges = {
  number: number;
  title: string;
  author: string;
  head: string;
  base: string;
  headOid: string;
  updatedAt: string;
  url: string;
  baseOid: string;
  mergeBase: string;
  headCommit: string;
  files: ChangedFile[];
};

export type DocResponse = {
  /** 소스 키: `local` · `main` · `pr:<n>`. */
  source: string;
  /** 읽은 커밋의 짧은 oid. 저장소가 아니면 null. */
  head: string | null;
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  bodyStartLine: number;
  /** 원문 frontmatter 블록(--- 포함). 템플릿 보기에 쓴다. */
  frontmatterRaw?: string;
  headings: Heading[];
  links: DocLink[];
  /** 노트 임베드(`![[노트]]`) 대상 본문. 키는 `embedKey(target, anchor)`. 임베드가 없으면 빠진다. */
  embeds?: Record<string, DocEmbed>;
  backlinks: Backlink[];
  stamp: { commit: string | null; dirty: boolean };
  mtime: number;
  ignored: boolean;
  /** src=pr:<n> 일 때만. */
  change?: DocChange;
  /** src=pr:<n> 인데 변경 목록을 못 떴을 때 그 까닭(가린 것). 그때 change 는 없다. */
  changeError?: string;
};

export type ResolveResponse = Record<string, unknown>;
export type PreviewResponse = { path: string; title: string; type: string | null; status: string | null; excerpt: string };

export type RevealRequest = { dir: string; tick: number };

/** /api/titles: lint 범위 md 전부의 경로·제목. 제목 즉시 검색·트리 필터가 쓴다. */
export type TitleItem = { path: string; title: string };
export type TitlesResponse = { version: number; items: TitleItem[] };

export type SearchScope = 'lint' | 'all';
export type SearchHit = { path: string; title: string; score: number; snippet: string };
export type SearchResponse = { q: string; scope: SearchScope; hits: SearchHit[] };

// PR 패널. 정본은 server/panels/prs.ts 다.
export type Pr = {
  number: number;
  title: string;
  assignees: string[];
  author: string;
  headRefName: string;
  updatedAt: string;
  url: string;
  isDraft: boolean;
};
export type PrFile = { path: string; md: boolean; viewable: boolean };
export type PrListResponse = { repo: string | null; prs: Pr[]; truncated: boolean; fetchedAt: string; error: string | null };
export type PrFilesResponse = { repo: string | null; number: number; files: PrFile[]; truncated: boolean; error: string | null };
export type PrReposResponse = { repos: string[]; vaultRepo: string | null; error: string | null };

export type VaultInfo = {
  name: string;
  branch: string | null;
  head: string | null;
  worktree: boolean;
  dirty: boolean;
  /** git 소스(@main·@pr) /raw 를 내는 별도 출처의 포트. 옛 서버엔 없다(그때는 주 포트 + 1). */
  gitRawPort?: number;
  /** 임베딩 묶음을 쓸 수 있는가(서버 설정). 옛 서버엔 없다(그때는 못 쓴다). */
  embeddings?: { available: boolean; model: string | null };
  sources: {
    main: { available: boolean; head: string | null; fetchedAt: number | null; reason?: string };
    local: { available: boolean; head: string | null };
  };
};

// 지도(링크 그래프). 정본은 server/graph.ts 다.
export type GraphNode = {
  path: string;
  title: string;
  kind: Kind;
  cluster: string;
  /** 임베딩 군집 이름(`#3 · 제목`). 질의에 embed 를 실었고 서버 군집이 준비됐을 때만 온다. */
  embedCluster?: string;
  /** 중심에서 처음 닿은 홉. 전체 보기에서는 -1 이다. */
  hop: number;
  /** 전체 그래프 기준 연결 수. 화면에 보이는 수가 아니다. */
  in: number;
  out: number;
  hub: boolean;
  /** 이 노드 너머에 응답 밖 이웃이 있다. */
  truncated: boolean;
};
export type GraphLink = { source: string; target: string; weight: number; mutual: boolean };
export type GraphResponse = {
  center: string | null;
  depth: number;
  hubThreshold: number;
  version: number;
  nodes: GraphNode[];
  links: GraphLink[];
};
/** embed 는 임베딩 군집 표지(준비된 군집 시각) — 있으면 서버가 노드에 embedCluster 를 싣고, 값이 바뀌면 다시 받는다. */
export type GraphQuery = ({ center: string; depth: number; hubs: 'keep' | 'expand'; expand: string[] } | { all: true }) & { embed?: string };
