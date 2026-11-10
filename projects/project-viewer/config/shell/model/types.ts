// 공유 계약 타입 — 코디네이터가 G1(스키마 동결) 뒤에 확정했다. 작업 패키지는 이 파일을 고치지 않는다.
// 필드의 뜻과 검사 규칙은 docs/schema.md, 배경은 docs/design.md.

export type Tone = 'muted' | 'blue' | 'amber' | 'green' | 'red';

// ── 근거 참조 ────────────────────────────────────────────────────────────────
// 네 형태 중 하나. at·lines·find는 동시에 둘 이상 쓸 수 없다. label은 버튼에 보일 이름(선택).
export interface EvidenceRef {
  source: string;
  at?: string;
  lines?: string; // "40-52" 또는 "40"
  find?: string;
  label?: string;
}
export interface ResolvedTarget {
  source: string;
  slug?: string; // 가장 가까운 위쪽 헤딩의 슬러그 (md 문서일 때)
  line?: number; // 1부터
  verified: boolean; // 저장소 코드 원본을 로컬에서 확인하지 못했으면 false
}
export type ResolvedEvidence = EvidenceRef & { resolved: ResolvedTarget };

// 라벨이 붙은 짧은 서술 조각. "주의", "검증 방법", "영향" 같은 프로젝트 고유 칸을 담는다.
export interface Field {
  label: string;
  text: string;
}

// ── 원본 ─────────────────────────────────────────────────────────────────────
export interface SourceSpec {
  id: string; // ^[a-z0-9][a-z0-9-]*$
  path: string; // repo가 없으면 볼트 루트 기준, 있으면 그 저장소 루트 기준 상대경로
  title?: string;
  group?: string;
  role: 'primary' | 'reference' | 'ledger';
  kind: 'doc' | 'code' | 'data';
  repo?: string; // "<org>/<name>" — 볼트 밖 저장소의 코드. kind: code에서만
  commit?: string; // 기준선 커밋 (repo가 있을 때)
  url_base?: string; // 예: https://github.com/<org>/<name>/blob/<commit> — 있어야만 외부 링크를 만든다
}
export interface Heading {
  depth: number;
  text: string;
  slug: string;
  line: number;
}
export interface SourceDoc extends SourceSpec {
  title: string; // yml의 title → frontmatter title → 첫 h1 → 파일 이름
  frontmatter: Record<string, unknown>;
  body: string; // frontmatter를 뗀 원문 그대로. repo 원본은 내장하지 않으므로 ''
  digest: string; // sha256 앞 12자. 읽지 못했으면 ''
  headings: Heading[];
  missing: boolean;
  embedded: boolean; // 본문이 Bundle에 들어 있는가
}

// ── 블록 ─────────────────────────────────────────────────────────────────────
interface BlockBase {
  id?: string;
  title?: string;
  intro?: string;
  evidence?: EvidenceRef[]; // 블록 근거. 자기 근거가 없는 항목이 물려받는다(화면과 스탬프에 드러난다)
}

export interface GraphNode {
  id: string;
  label: string;
  group?: string;
  tag?: string;
  easy?: string;
  tech?: string;
  fields?: Field[];
  evidence?: EvidenceRef[];
}
export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  style?: 'solid' | 'dashed';
  both?: boolean;
}
export interface GraphBlock extends BlockBase {
  type: 'graph';
  groups?: { id: string; label: string }[];
  nodes: GraphNode[];
  edges?: GraphEdge[];
}

export interface TreeNode {
  id: string;
  label: string;
  parent?: string; // 없으면 최상위
  tag?: string;
  easy?: string;
  tech?: string;
  fields?: Field[];
  evidence?: EvidenceRef[];
}
export interface TreeBlock extends BlockBase {
  type: 'tree';
  nodes: TreeNode[];
}

export interface SequenceStep {
  id: string;
  label: string;
  lane?: string; // 이 스텝이 일어나는 자리 (짧은 이름)
  easy?: string;
  why?: string;
  tech?: string;
  fields?: Field[];
  evidence?: EvidenceRef[];
}
export interface SequenceBlock extends BlockBase {
  type: 'sequence';
  fields?: Field[];
  steps: SequenceStep[];
}

export interface StageItem {
  id: string;
  label: string;
  required?: boolean; // 기본 true
  criteria?: string;
  fields?: Field[];
  evidence?: EvidenceRef[];
}
export interface Stage {
  id: string;
  title: string;
  short?: string;
  question?: string;
  owner?: string;
  output?: string;
  stop?: string;
  fields?: Field[];
  detail?: EvidenceRef; // 이 단계의 상세 원문
  status_from?: { source: string }; // 그 문서의 frontmatter status를 읽는다. 없으면 원장
  parent?: string; // 같은 블록의 상위 단계 id. 최상위 단계만 가리킬 수 있다(한 단만 중첩)
  after?: string[]; // 이 단계보다 먼저 끝나야 하는(막고 있는) 같은 블록의 단계 id
  items?: StageItem[];
}
export interface StagesBlock extends BlockBase {
  type: 'stages';
  stages: Stage[];
}

export interface Item {
  id: string;
  label: string;
  body?: string;
  tags?: string[];
  refs?: string[]; // 관련 항목 id (방향 없음). 뷰어 안의 어떤 id든 가리킬 수 있다
  fields?: Field[];
  evidence?: EvidenceRef[];
}
export interface ItemsBlock extends BlockBase {
  type: 'items';
  expect_count?: number;
  items: Item[];
}

export type Cell = string | { text: string; evidence?: EvidenceRef[] };
export interface TableBlock extends BlockBase {
  type: 'table';
  expect_count?: number;
  columns: { id: string; label: string; derived?: boolean }[]; // derived: 이 열은 원문이 아니라 해설
  rows: { id: string; cells: Record<string, Cell>; evidence?: EvidenceRef[] }[];
}

export interface MermaidBlock extends BlockBase {
  type: 'mermaid';
  code: string;
}
export interface ProseBlock extends BlockBase {
  type: 'prose';
  text: string;
}

export type Block =
  | GraphBlock
  | TreeBlock
  | SequenceBlock
  | StagesBlock
  | ItemsBlock
  | TableBlock
  | MermaidBlock
  | ProseBlock;
export type BlockType = Block['type'];

// ── viewer.yml ───────────────────────────────────────────────────────────────
export interface GlossaryTerm {
  id: string;
  term: string;
  easy: string;
  tech?: string;
  fields?: Field[];
  evidence: EvidenceRef[]; // 용어는 물려받을 블록이 없으므로 항상 필수
}
export interface Page {
  id: string;
  title: string;
  layout?: 'stack' | 'tabs'; // 블록 여러 개를 세로로 쌓을지 탭으로 나눌지. 기본 stack
  blocks: Block[];
}
export interface StatusDef {
  label: string;
  tone: Tone;
  done?: boolean;
  motion?: 'pulse'; // 진행 중 표시 — 배지가 느리게 숨 쉰다. 선언한 상태만
  struck?: boolean; // 폐기 표시 — 배지·제목에 취소선. 선언한 상태만
}
export interface ViewerDoc {
  schema_version: 1;
  meta: { title: string; kind: 'project' | 'explainer'; audience?: string; summary?: string };
  sources: SourceSpec[];
  statuses?: Record<string, StatusDef>; // 원장이 없는 뷰어가 status_from을 쓸 때의 어휘
  glossary?: GlossaryTerm[];
  pages: Page[];
}

// ── 상태 원장 ────────────────────────────────────────────────────────────────
export interface LedgerRef {
  path: string; // 볼트 루트 기준 상대경로
  at?: string;
  lines?: string;
  find?: string;
  label?: string;
}
export interface LedgerEntry {
  status: string;
  note?: string;
  evidence?: LedgerRef[];
}
export interface LedgerDoc {
  schema_version: 1;
  statuses: Record<string, StatusDef>;
  default: string;
  defaults?: { match: string; status: string }[]; // id 글롭(* 만 지원). 위에서부터 첫 일치
  stages?: Record<string, LedgerEntry>;
  items?: Record<string, LedgerEntry>;
}

// ── 검사 결과와 Bundle ───────────────────────────────────────────────────────
export interface Issue {
  level: 'error' | 'warning';
  code: string; // 예: E_UNKNOWN_KEY, E_REF_UNRESOLVED, W_REFERENCE_MISSING
  message: string;
  where: string; // 예: pages[1].blocks[0].nodes[3].evidence[0]
  count?: number; // 여러 자리를 한 건으로 모았을 때의 자리 수 (W_INHERITED). 없으면 1건이다
}
export interface StatusView {
  status: string | null;
  label: string;
  tone: Tone;
  done: boolean;
  motion?: 'pulse'; // 어휘에 선언했을 때만 있다 — 없으면 Bundle이 이전과 바이트 단위로 같다
  struck?: true;
  note?: string;
  origin: 'ledger' | 'ledger-default' | 'frontmatter' | 'none';
  evidence: (LedgerRef & { resolved: { path: string; source?: string; slug?: string; line?: number } })[];
}
export interface Stamp {
  builtAt: string; // ISO
  commit: string | null;
  dirty: boolean;
  docCount: number;
  ymlDigest: string;
  ledgerDigest: string | null;
  counts: {
    unresolvedLinks: number; // 원문 md 안의 링크 중 sources 범위 밖
    missingReferences: number; // role: reference 원본 누락
    unverifiedCode: number; // 로컬에서 확인하지 못한 저장소 코드 근거
    inheritedEvidence: number; // 자기 근거 없이 블록 근거를 물려받은 해설 항목
  };
}
export interface BackRef {
  kind: 'glossary' | 'node' | 'step' | 'stage' | 'item' | 'row' | 'block';
  id: string;
  page?: string;
  label: string;
}
// Bundle 안의 ViewerDoc은 모든 EvidenceRef 자리에 resolved가 채워져 있다.
export interface Bundle {
  viewer: ViewerDoc;
  docs: Record<string, SourceDoc>;
  status: Record<string, StatusView>;
  backlinks: Record<string, BackRef[]>;
  stamp: Stamp;
  issues: Issue[]; // 경고만
}
export interface CheckResult {
  ok: boolean;
  issues: Issue[];
  viewer?: ViewerDoc; // ok일 때: evidence가 해소된 형태
  ledger?: LedgerDoc | null;
  status?: Record<string, StatusView>;
  inheritedEvidence?: number;
  unverifiedCode?: number;
}
