// viewer.yml 하나에서 Bundle 하나를 만든다. 검사 → 원본 수집 → 역링크 → 스탬프 순이다.
// 부수효과(파일·git·시계)는 전부 주입받고, 같은 입력이면 같은 바이트가 나온다.
import fs from 'node:fs';
import path from 'node:path';

import { fromMarkdown } from 'mdast-util-from-markdown';
import { visit } from 'unist-util-visit';

import type {
  BackRef,
  Bundle,
  Cell,
  EvidenceRef,
  Heading,
  Issue,
  SourceDoc,
  SourceSpec,
  ViewerDoc,
} from '../model/index.ts';
import { checkProject, extractHeadings, splitFrontmatter } from '../model/index.ts';
import { findVaultRoot, makeReadFile, makeReadRepoFile } from './vault.ts';
import type { SourcePaths } from './doclinks.ts';
import { basename, classifyLink, resolveWikilink } from './doclinks.ts';
import type { GitInfo, RunGit } from './stamp.ts';
import { digest12, makeStamp, readGit } from './stamp.ts';

export interface CollectOptions {
  projectDir: string;
  git: GitInfo;
  now: () => Date;
  /** 볼트 밖 저장소 체크아웃의 상위 폴더. 없으면 저장소 코드는 확인하지 않는다. */
  reposDir?: string;
  /** viewer.yml 본문. 주면 디스크에서 읽지 않는다(볼트 뷰어 통합 보기가 소스 리더로 읽어 넘긴다). */
  viewerText?: string;
  /** 볼트 상대경로 → 본문. 없으면 디스크(makeReadFile)다. viewerText 와 함께 주면 디스크를 만지지 않는다. */
  readFile?: (vaultPath: string) => string | null;
}

/** 검사 오류가 있으면 수집하지 않는다 — 산출물이 조용히 어긋나는 것을 막기 위해서다. */
export class CheckError extends Error {
  readonly issues: Issue[];
  constructor(issues: Issue[]) {
    const errors = issues.filter((i) => i.level === 'error');
    super(
      [
        `viewer.yml 검사에서 오류 ${errors.length}건이 나왔다:`,
        ...errors.map((i) => `  [${i.code}] ${i.where || '(문서 전체)'} — ${i.message}`),
      ].join('\n'),
    );
    this.name = 'CheckError';
    this.issues = issues;
  }
}

interface Loaded {
  doc: SourceDoc;
  bodyStartLine: number;
}

const WIKILINK = /\[\[([^[\]]+)\]\]/g;

function firstH1(headings: Heading[]): string | undefined {
  return headings.find((h) => h.depth === 1)?.text;
}

function frontmatterTitle(data: Record<string, unknown>): string | undefined {
  const raw = data['title'];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

function loadSource(
  spec: SourceSpec,
  readFile: (p: string) => string | null,
  readRepoFile: ((repo: string, p: string) => string | null) | undefined,
): Loaded {
  const fromRepo = spec.repo !== undefined;
  const text = fromRepo ? (readRepoFile?.(spec.repo!, spec.path) ?? null) : readFile(spec.path);

  let frontmatter: Record<string, unknown> = {};
  let bodyText = text ?? '';
  let headings: Heading[] = [];
  let bodyStartLine = 1;
  // code·data는 원문을 그대로 보여 준다. frontmatter처럼 생긴 줄도 본문이다.
  if (text !== null && spec.kind === 'doc') {
    const split = splitFrontmatter(text);
    frontmatter = split.data;
    bodyText = split.body;
    bodyStartLine = split.bodyStartLine;
    const offset = split.bodyStartLine - 1;
    // 줄 번호 기준은 model(check.ts)의 적재부와 같아야 한다 — 파일 기준이다.
    headings = extractHeadings(split.body).map((h) => ({ ...h, line: h.line + offset }));
  }

  // 저장소 코드는 좌표만 보여 주므로 본문을 내장하지 않는다.
  const embedded = !fromRepo && text !== null;
  const doc: SourceDoc = {
    ...spec,
    // yml에 붙인 표시 이름이 가장 앞선다 — 뷰어 작성자가 내비게이터에 보일 이름을 정한 것이다.
    title: spec.title ?? frontmatterTitle(frontmatter) ?? firstH1(headings) ?? basename(spec.path),
    frontmatter,
    body: embedded ? bodyText : '',
    digest: text === null ? '' : digest12(text),
    headings,
    missing: text === null,
    embedded,
  };
  return { doc, bodyStartLine };
}

/** 원문 md 안의 링크 중 sources 범위 밖인 것을 건마다 경고 하나로 만든다. */
function scanLinks(loaded: Loaded, sourcePaths: SourcePaths): Issue[] {
  const { doc, bodyStartLine } = loaded;
  if (doc.kind !== 'doc' || !doc.embedded || doc.missing) return [];

  const offset = bodyStartLine - 1;
  const issues: Issue[] = [];
  const report = (raw: string, reason: string, line: number): void => {
    issues.push({
      level: 'warning',
      code: 'W_LINK_UNRESOLVED',
      message: `원문 링크가 sources 밖이다: ${raw} — ${reason}`,
      where: `docs.${doc.id}:${line + offset}`,
    });
  };

  const tree = fromMarkdown(doc.body);
  visit(tree, (node) => {
    const line = node.position?.start.line ?? 1;
    if (node.type === 'link') {
      const result = classifyLink(node.url, doc.path, sourcePaths);
      if (result.kind === 'missing') report(node.url, result.reason, line);
      return;
    }
    // 코드펜스(code)와 인라인 코드(inlineCode)는 text 노드가 아니므로 자연히 빠진다.
    if (node.type !== 'text') return;
    WIKILINK.lastIndex = 0;
    let match = WIKILINK.exec(node.value);
    while (match !== null) {
      const result = resolveWikilink(match[1]!, sourcePaths);
      if (result.kind === 'missing') {
        const before = node.value.slice(0, match.index);
        let newlines = 0;
        for (let i = 0; i < before.length; i += 1) if (before.charCodeAt(i) === 10) newlines += 1;
        report(match[0], result.reason, line + newlines);
      }
      match = WIKILINK.exec(node.value);
    }
  });
  return issues;
}

function cellText(cell: Cell): string {
  return typeof cell === 'string' ? cell : cell.text;
}
function cellEvidence(cell: Cell): EvidenceRef[] | undefined {
  return typeof cell === 'string' ? undefined : cell.evidence;
}

/**
 * 원본 id → 그 문서를 근거로 쓰는 항목.
 * yml에 실제로 적힌 evidence만 본다 — 물려받은 항목은 블록 1건으로만 세기 위해서다.
 */
function collectBacklinks(viewer: ViewerDoc, ids: string[]): Record<string, BackRef[]> {
  const out: Record<string, BackRef[]> = {};
  const seen = new Map<string, Set<string>>();
  for (const id of ids) {
    out[id] = [];
    seen.set(id, new Set());
  }

  const add = (evidence: EvidenceRef[] | undefined, ref: BackRef): void => {
    for (const e of evidence ?? []) {
      const list = out[e.source];
      const marks = seen.get(e.source);
      if (!list || !marks) continue; // 모르는 원본 id는 검사에서 이미 막혔다
      const key = `${ref.kind}:${ref.id}`;
      if (marks.has(key)) continue;
      marks.add(key);
      list.push(ref);
    }
  };

  for (const term of viewer.glossary ?? []) {
    add(term.evidence, { kind: 'glossary', id: term.id, label: term.term });
  }

  for (const page of viewer.pages) {
    page.blocks.forEach((block, bi) => {
      const blockId = block.id ?? `${page.id}.blocks[${bi}]`;
      add(block.evidence, {
        kind: 'block',
        id: blockId,
        page: page.id,
        label: block.title ?? page.title,
      });

      switch (block.type) {
        case 'graph':
        case 'tree':
          for (const node of block.nodes) {
            add(node.evidence, { kind: 'node', id: node.id, page: page.id, label: node.label });
          }
          break;
        case 'sequence':
          for (const step of block.steps) {
            add(step.evidence, { kind: 'step', id: step.id, page: page.id, label: step.label });
          }
          break;
        case 'stages':
          for (const stage of block.stages) {
            add(stage.detail ? [stage.detail] : undefined, {
              kind: 'stage',
              id: stage.id,
              page: page.id,
              label: stage.title,
            });
            for (const item of stage.items ?? []) {
              add(item.evidence, { kind: 'item', id: item.id, page: page.id, label: item.label });
            }
          }
          break;
        case 'items':
          for (const item of block.items) {
            add(item.evidence, { kind: 'item', id: item.id, page: page.id, label: item.label });
          }
          break;
        case 'table': {
          const firstColumn = block.columns[0]?.id;
          for (const row of block.rows) {
            const cell = firstColumn === undefined ? undefined : row.cells[firstColumn];
            const ref: BackRef = {
              kind: 'row',
              id: row.id,
              page: page.id,
              label: cell === undefined ? row.id : cellText(cell),
            };
            add(row.evidence, ref);
            for (const key of Object.keys(row.cells)) add(cellEvidence(row.cells[key]!), ref);
          }
          break;
        }
        default:
          break;
      }
    });
  }

  return out;
}

export function collect(options: CollectOptions): Bundle {
  const { projectDir, git, now, reposDir } = options;
  // 본문과 읽기 함수를 둘 다 받으면 디스크(볼트 루트 탐색 포함)를 건너뛴다.
  const injected = options.viewerText !== undefined && options.readFile !== undefined;
  const root = injected ? '' : findVaultRoot(projectDir);
  const viewerText = options.viewerText ?? readViewerText(root, projectDir);

  const readFile = options.readFile ?? makeReadFile(root);
  const readRepoFile = reposDir === undefined ? undefined : makeReadRepoFile(reposDir);
  const result = checkProject({ viewerText, readFile, readRepoFile });
  if (!result.ok || !result.viewer) throw new CheckError(result.issues);
  const viewer = result.viewer;

  const loaded = viewer.sources.map((spec) => loadSource(spec, readFile, readRepoFile));
  const docs: Record<string, SourceDoc> = {};
  const sourcePaths: SourcePaths = new Map();
  for (const item of loaded) {
    docs[item.doc.id] = item.doc;
    // 저장소 원본의 path는 볼트 경로가 아니므로 링크 해소 대상이 아니다.
    if (item.doc.repo === undefined && !sourcePaths.has(item.doc.path)) {
      sourcePaths.set(item.doc.path, item.doc.id);
    }
  }

  const linkIssues = loaded.flatMap((item) => scanLinks(item, sourcePaths));
  const issues: Issue[] = [...result.issues.filter((i) => i.level === 'warning'), ...linkIssues];

  const ledgerSpec = viewer.sources.find((s) => s.role === 'ledger');
  const ledgerDigest = ledgerSpec ? (docs[ledgerSpec.id]?.digest || null) : null;

  const stamp = makeStamp({
    now,
    git,
    docCount: viewer.sources.length,
    ymlDigest: digest12(viewerText),
    ledgerDigest,
    counts: {
      unresolvedLinks: linkIssues.length,
      missingReferences: result.issues.filter((i) => i.code === 'W_REFERENCE_MISSING').length,
      unverifiedCode: result.unverifiedCode ?? 0,
      inheritedEvidence: result.inheritedEvidence ?? 0,
    },
  });

  return {
    viewer,
    docs,
    status: result.status ?? {},
    backlinks: collectBacklinks(viewer, viewer.sources.map((s) => s.id)),
    stamp,
    issues,
  };
}

/** 디스크의 `<프로젝트>/config/viewer.yml`을 읽는다. 없으면 예외다. */
function readViewerText(root: string, projectDir: string): string {
  const viewerPath = path.join(projectDir, 'config', 'viewer.yml');
  if (!fs.existsSync(viewerPath)) {
    throw new Error(`viewer.yml이 없다: ${path.relative(root, viewerPath)}`);
  }
  return fs.readFileSync(viewerPath, 'utf8');
}

/** 빌드가 지켜봐야 할 파일들(yml + 볼트 안 원본). dev의 watch와 dirty 판정이 함께 쓴다. */
export function watchTargets(projectDir: string): { root: string; files: string[] } {
  const root = findVaultRoot(projectDir);
  const viewerPath = path.join(projectDir, 'config', 'viewer.yml');
  const files = [viewerPath];
  if (fs.existsSync(viewerPath)) {
    try {
      const result = checkProject({ viewerText: fs.readFileSync(viewerPath, 'utf8'), readFile: makeReadFile(root) });
      for (const spec of result.viewer?.sources ?? []) {
        if (spec.repo === undefined) files.push(path.join(root, spec.path));
      }
    } catch {
      // yml이 깨졌을 때도 최소한 yml 자신은 지켜본다.
    }
  }
  return { root, files };
}

/**
 * 이 뷰어에 관련된 경로(yml + 볼트 안 원본)만으로 커밋과 dirty를 읽는다.
 * 저장소 전체를 보면 뷰어와 무관한 변경이나 빌드 산출물 자신 때문에 늘 dirty가 된다.
 * CLI 요약과 플러그인이 같은 판정을 쓰도록 한 곳에 둔다.
 */
export function readProjectGit(projectDir: string, run?: RunGit): GitInfo {
  const { root, files } = watchTargets(projectDir);
  const paths = files.map((f) => path.relative(root, f).split(path.sep).join('/'));
  return readGit(root, run === undefined ? { paths } : { paths, run });
}

