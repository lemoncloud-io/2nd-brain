// 전체 검사. 순수 함수 — 파일은 주입받은 readFile/readRepoFile로만 읽는다.
import type {
  Block,
  Cell,
  CheckResult,
  EvidenceRef,
  Field,
  Heading,
  Issue,
  LedgerDoc,
  LedgerRef,
  ResolvedEvidence,
  SourceSpec,
  StagesBlock,
  ViewerDoc,
} from './types.ts';
import { splitFrontmatter } from './frontmatter.ts';
import { ModelError, parseLedger, parseViewer } from './parse.ts';
import { resolveRef } from './resolve.ts';
import { extractHeadings } from './slug.ts';
import type { StageSpec } from './rules.ts';
import { evaluateStatus } from './rules.ts';

export interface CheckInput {
  viewerText: string;
  readFile: (vaultPath: string) => string | null;
  readRepoFile?: (repo: string, path: string) => string | null;
}

const LEDGER_WHERE = 'ledger';

interface LoadedSource {
  spec: SourceSpec;
  index: number;
  unsafe: boolean;
  fromRepo: boolean;
  text: string | null;
  headings: Heading[];
  frontmatter: Record<string, unknown>;
}

/** 절대경로거나 볼트 밖으로 나가는가. 경로 계산은 순수하게 문자열로 한다. */
export function isUnsafePath(p: string): boolean {
  if (p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(p)) return true;
  let depth = 0;
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      depth -= 1;
      if (depth < 0) return true;
    } else depth += 1;
  }
  return false;
}

function nonEmpty(...values: (string | undefined)[]): boolean {
  return values.some((v) => typeof v === 'string' && v.trim() !== '');
}
function fieldsSpeak(fields: Field[] | undefined): boolean {
  return (fields ?? []).some((f) => f.text.trim() !== '');
}

export function checkProject(input: CheckInput): CheckResult {
  let viewer: ViewerDoc;
  try {
    viewer = parseViewer(input.viewerText);
  } catch (err) {
    if (err instanceof ModelError) return { ok: false, issues: err.issues };
    throw err;
  }

  const issues: Issue[] = [];
  const add = (code: string, where: string, message: string, level: Issue['level'] = 'error'): void => {
    issues.push({ level, code, message, where });
  };

  // ── 원본 ───────────────────────────────────────────────────────────────────
  const sources = new Map<string, LoadedSource>();
  const pathToId = new Map<string, string>();
  const ledgerSources: LoadedSource[] = [];

  viewer.sources.forEach((spec, index) => {
    const where = `sources[${index}]`;
    if (sources.has(spec.id)) {
      add('E_DUP_ID', `${where}.id`, `원본 id가 중복이다: ${spec.id}`);
      return;
    }
    const unsafe = isUnsafePath(spec.path);
    if (unsafe) add('E_PATH', `${where}.path`, `절대경로거나 볼트 밖을 가리킨다: ${spec.path}`);

    const fromRepo = spec.repo !== undefined;
    let text: string | null = null;
    if (!unsafe) {
      text = fromRepo ? (input.readRepoFile?.(spec.repo!, spec.path) ?? null) : input.readFile(spec.path);
    }

    if (!unsafe && text === null && !fromRepo) {
      if (spec.role === 'reference') add('W_REFERENCE_MISSING', where, `참고 원본이 없다: ${spec.path}`, 'warning');
      else add('E_SOURCE_MISSING', where, `${spec.role} 원본이 없다: ${spec.path}`);
    }

    let headings: Heading[] = [];
    let frontmatter: Record<string, unknown> = {};
    if (text !== null && spec.kind === 'doc') {
      const split = splitFrontmatter(text);
      frontmatter = split.data;
      const offset = split.bodyStartLine - 1;
      headings = extractHeadings(split.body).map((h) => ({ ...h, line: h.line + offset }));
    }

    const loaded: LoadedSource = { spec, index, unsafe, fromRepo, text, headings, frontmatter };
    sources.set(spec.id, loaded);
    if (!pathToId.has(spec.path)) pathToId.set(spec.path, spec.id);
    if (spec.role === 'ledger') {
      if (ledgerSources.length > 0) add('E_KIND', `${where}.role`, 'ledger 원본은 뷰어당 0개 또는 1개다');
      else ledgerSources.push(loaded);
    }
  });

  // ── id 이름공간 ────────────────────────────────────────────────────────────
  const ids = new Map<string, string>();
  const claim = (id: string | undefined, where: string): void => {
    if (id === undefined) return;
    const seen = ids.get(id);
    if (seen !== undefined) add('E_DUP_ID', `${where}.id`, `id가 중복이다: ${id} (먼저 ${seen})`);
    else ids.set(id, where);
  };

  viewer.glossary?.forEach((term, i) => claim(term.id, `glossary[${i}]`));
  viewer.pages.forEach((page, pi) => {
    const pw = `pages[${pi}]`;
    claim(page.id, pw);
    page.blocks.forEach((block, bi) => {
      const bw = `${pw}.blocks[${bi}]`;
      claim(block.id, bw);
      switch (block.type) {
        case 'graph':
          block.groups?.forEach((g, i) => claim(g.id, `${bw}.groups[${i}]`));
          block.nodes.forEach((n, i) => claim(n.id, `${bw}.nodes[${i}]`));
          break;
        case 'tree':
          block.nodes.forEach((n, i) => claim(n.id, `${bw}.nodes[${i}]`));
          break;
        case 'sequence':
          block.steps.forEach((s, i) => claim(s.id, `${bw}.steps[${i}]`));
          break;
        case 'stages':
          block.stages.forEach((s, i) => {
            claim(s.id, `${bw}.stages[${i}]`);
            s.items?.forEach((it, j) => claim(it.id, `${bw}.stages[${i}].items[${j}]`));
          });
          break;
        case 'items':
          block.items.forEach((it, i) => claim(it.id, `${bw}.items[${i}]`));
          break;
        case 'table':
          block.rows.forEach((r, i) => claim(r.id, `${bw}.rows[${i}]`));
          break;
        default:
          break;
      }
    });
  });

  // ── 근거 참조 해소 ─────────────────────────────────────────────────────────
  let unverifiedCode = 0;
  const resolveEvidence = (ref: EvidenceRef, where: string): void => {
    const target = ref as ResolvedEvidence;
    const src = sources.get(ref.source);
    if (!src) {
      add('E_SOURCE_UNKNOWN', `${where}.source`, `sources에 없는 원본 id다: ${ref.source}`);
      target.resolved = { source: ref.source, slug: undefined, line: undefined, verified: false };
      return;
    }
    if (src.fromRepo && src.text === null) {
      add('W_CODE_UNVERIFIED', where, `저장소 코드를 로컬에서 확인하지 못했다: ${src.spec.repo}/${src.spec.path}`, 'warning');
      unverifiedCode += 1;
      target.resolved = { source: ref.source, slug: undefined, line: undefined, verified: false };
      return;
    }
    if (src.text === null) {
      // 원본 누락은 sources 단계에서 이미 오류·경고로 보고했다.
      target.resolved = { source: ref.source, slug: undefined, line: undefined, verified: false };
      return;
    }
    const r = resolveRef(ref, src.text, src.headings);
    if (!r.ok) {
      add('E_REF_UNRESOLVED', where, r.reason);
      target.resolved = { source: ref.source, slug: undefined, line: undefined, verified: false };
      return;
    }
    target.resolved = { source: ref.source, slug: r.slug, line: r.line, verified: true };
  };
  const resolveList = (list: EvidenceRef[] | undefined, where: string): void => {
    list?.forEach((ref, i) => resolveEvidence(ref, `${where}.evidence[${i}]`));
  };

  // ── 근거 필수와 물려받기 ───────────────────────────────────────────────────
  // 경고는 블록마다 1건으로 모은다. 종류별 수를 처음 나온 순서로 들고 있다가 블록 끝에서 낸다.
  let inheritedEvidence = 0;
  let inheritedKinds = new Map<string, number>();
  const requireEvidence = (
    own: EvidenceRef[] | undefined,
    blockHas: boolean,
    where: string,
    what: string,
  ): void => {
    if ((own?.length ?? 0) > 0) return;
    if (blockHas) {
      inheritedKinds.set(what, (inheritedKinds.get(what) ?? 0) + 1);
      inheritedEvidence += 1;
      return;
    }
    add('E_NO_EVIDENCE', where, `${what}에 해설이 있는데 근거가 없다`);
  };
  const flushInherited = (bw: string): void => {
    const kinds = inheritedKinds;
    inheritedKinds = new Map();
    let total = 0;
    for (const n of kinds.values()) total += n;
    if (total === 0) return;
    const detail = [...kinds].map(([what, n]) => `${what} ${n}`).join(' · ');
    issues.push({
      level: 'warning',
      code: 'W_INHERITED',
      message: `블록 근거를 물려받은 항목 ${total}개 (${detail})`,
      where: bw,
      count: total,
    });
  };

  const cellText = (cell: Cell): string => (typeof cell === 'string' ? cell : cell.text);
  const cellEvidence = (cell: Cell): EvidenceRef[] | undefined => (typeof cell === 'string' ? undefined : cell.evidence);

  const stageSpecs: StageSpec[] = [];

  viewer.pages.forEach((page, pi) => {
    page.blocks.forEach((block, bi) => {
      const bw = `pages[${pi}].blocks[${bi}]`;
      resolveList(block.evidence, bw);
      const blockHas = (block.evidence?.length ?? 0) > 0;

      if (nonEmpty(block.intro) && !blockHas) {
        add('E_NO_EVIDENCE', bw, '블록 도입 문단이 해설인데 블록 근거가 없다');
      }
      checkBlockBody(block, bw, blockHas);
      flushInherited(bw);
    });
  });

  // 단계 사이의 연결(parent·after)은 같은 블록의 단계만 가리킨다. parent는 한 단만 중첩한다 —
  // 상위 단계가 또 상위를 가지면 띠와 흐름 그림이 어느 줄에 놓을지 정할 수 없다.
  function checkStageLinks(block: StagesBlock, bw: string): void {
    const byId = new Map(block.stages.map((s) => [s.id, s]));
    block.stages.forEach((s, i) => {
      const w = `${bw}.stages[${i}]`;
      if (s.parent !== undefined) {
        const parent = byId.get(s.parent);
        if (!parent) add('E_BROKEN_REF', `${w}.parent`, `같은 블록에 그런 단계가 없다: ${s.parent}`);
        else if (parent.id === s.id) add('E_TREE_CYCLE', `${w}.parent`, `단계가 자기 자신을 parent로 가리킨다: ${s.id}`);
        else if (parent.parent !== undefined) {
          add('E_BROKEN_REF', `${w}.parent`, `parent는 최상위 단계만 가리킨다: ${s.parent}는 이미 ${parent.parent}의 하위 단계다`);
        }
      }
      s.after?.forEach((a, j) => {
        if (!byId.has(a)) add('E_BROKEN_REF', `${w}.after[${j}]`, `같은 블록에 그런 단계가 없다: ${a}`);
      });
    });
    const cycle = findAfterCycle(block.stages);
    if (cycle) add('E_TREE_CYCLE', `${bw}.stages`, `stages의 after에 순환이 있다: ${cycle.join(' → ')}`);
  }

  function checkBlockBody(block: Block, bw: string, blockHas: boolean): void {
    switch (block.type) {
      case 'graph': {
        const groupIds = new Set((block.groups ?? []).map((g) => g.id));
        const nodeIds = new Set(block.nodes.map((n) => n.id));
        block.nodes.forEach((n, i) => {
          const w = `${bw}.nodes[${i}]`;
          resolveList(n.evidence, w);
          if (n.group !== undefined && !groupIds.has(n.group)) {
            add('E_BROKEN_REF', `${w}.group`, `그런 그룹이 없다: ${n.group}`);
          }
          if (nonEmpty(n.easy, n.tech) || fieldsSpeak(n.fields)) requireEvidence(n.evidence, blockHas, w, '노드');
        });
        block.edges?.forEach((e, i) => {
          if (!nodeIds.has(e.from)) add('E_BROKEN_REF', `${bw}.edges[${i}].from`, `그런 노드가 없다: ${e.from}`);
          if (!nodeIds.has(e.to)) add('E_BROKEN_REF', `${bw}.edges[${i}].to`, `그런 노드가 없다: ${e.to}`);
        });
        break;
      }
      case 'tree': {
        const nodeIds = new Set(block.nodes.map((n) => n.id));
        block.nodes.forEach((n, i) => {
          const w = `${bw}.nodes[${i}]`;
          resolveList(n.evidence, w);
          if (n.parent !== undefined && !nodeIds.has(n.parent)) {
            add('E_BROKEN_REF', `${w}.parent`, `그런 노드가 없다: ${n.parent}`);
          }
          if (nonEmpty(n.easy, n.tech) || fieldsSpeak(n.fields)) requireEvidence(n.evidence, blockHas, w, '노드');
        });
        if (hasCycle(block.nodes)) add('E_TREE_CYCLE', `${bw}.nodes`, 'tree의 포함 관계에 순환이 있다');
        break;
      }
      case 'sequence': {
        if (fieldsSpeak(block.fields) && !blockHas) add('E_NO_EVIDENCE', bw, '블록 fields가 해설인데 블록 근거가 없다');
        block.steps.forEach((s, i) => {
          const w = `${bw}.steps[${i}]`;
          resolveList(s.evidence, w);
          if (nonEmpty(s.easy, s.tech, s.why) || fieldsSpeak(s.fields)) requireEvidence(s.evidence, blockHas, w, '스텝');
        });
        break;
      }
      case 'stages': {
        block.stages.forEach((s, i) => {
          const w = `${bw}.stages[${i}]`;
          if (s.detail) resolveEvidence(s.detail, `${w}.detail`);
          if (nonEmpty(s.question, s.output, s.stop) || fieldsSpeak(s.fields)) {
            requireEvidence(s.detail ? [s.detail] : undefined, blockHas, w, '단계');
          }
          let statusFrom: StageSpec['statusFrom'];
          if (s.status_from) {
            const src = sources.get(s.status_from.source);
            if (!src) add('E_SOURCE_UNKNOWN', `${w}.status_from.source`, `sources에 없는 원본 id다: ${s.status_from.source}`);
            else statusFrom = { source: src.spec.id, path: src.spec.path, value: src.frontmatter['status'] };
          }
          const items = (s.items ?? []).map((it, j) => {
            const iw = `${w}.items[${j}]`;
            resolveList(it.evidence, iw);
            if (nonEmpty(it.criteria) || fieldsSpeak(it.fields)) requireEvidence(it.evidence, blockHas, iw, '항목');
            return { id: it.id, required: it.required !== false };
          });
          stageSpecs.push({ id: s.id, where: w, statusFrom, items });
        });
        checkStageLinks(block, bw);
        break;
      }
      case 'items': {
        if (block.expect_count !== undefined && block.expect_count !== block.items.length) {
          add('E_COUNT', `${bw}.expect_count`, `선언한 수 ${block.expect_count}와 실제 ${block.items.length}가 다르다`);
        }
        block.items.forEach((it, i) => {
          const w = `${bw}.items[${i}]`;
          resolveList(it.evidence, w);
          it.refs?.forEach((ref, j) => {
            if (!ids.has(ref)) add('E_BROKEN_REF', `${w}.refs[${j}]`, `뷰어에 그런 id가 없다: ${ref}`);
          });
          if (nonEmpty(it.body) || fieldsSpeak(it.fields)) requireEvidence(it.evidence, blockHas, w, '항목');
        });
        break;
      }
      case 'table': {
        if (block.expect_count !== undefined && block.expect_count !== block.rows.length) {
          add('E_COUNT', `${bw}.expect_count`, `선언한 수 ${block.expect_count}와 실제 ${block.rows.length}가 다르다`);
        }
        const columnIds = new Set(block.columns.map((c) => c.id));
        block.rows.forEach((row, i) => {
          const w = `${bw}.rows[${i}]`;
          resolveList(row.evidence, w);
          let cellHas = false;
          let speaks = false;
          for (const [key, cell] of Object.entries(row.cells)) {
            if (!columnIds.has(key)) add('E_BROKEN_REF', `${w}.cells.${key}`, `그런 열이 없다: ${key}`);
            resolveList(cellEvidence(cell), `${w}.cells.${key}`);
            if ((cellEvidence(cell)?.length ?? 0) > 0) cellHas = true;
            if (cellText(cell).trim() !== '') speaks = true;
          }
          // 행의 근거는 행·셀·블록 중 한 곳에 있으면 된다.
          if (speaks && !cellHas) requireEvidence(row.evidence, blockHas, w, '행');
        });
        break;
      }
      case 'mermaid':
        if (!blockHas) add('E_NO_EVIDENCE', bw, 'mermaid 블록은 블록 근거가 필수다');
        break;
      case 'prose':
        if (!blockHas) add('E_NO_EVIDENCE', bw, 'prose 블록은 블록 근거가 필수다');
        break;
    }
  }

  viewer.glossary?.forEach((term, i) => {
    const w = `glossary[${i}]`;
    resolveList(term.evidence, w);
    if (term.evidence.length === 0) add('E_NO_EVIDENCE', w, '용어는 물려받을 블록이 없으므로 자기 근거가 필요하다');
  });

  if (viewer.meta.kind === 'project' && stageSpecs.length === 0) {
    add('E_KIND', 'meta.kind', 'kind: project인 뷰어는 stages 블록이 1개 이상 있어야 한다');
  }

  // ── 상태 원장 ──────────────────────────────────────────────────────────────
  let ledger: LedgerDoc | null = null;
  const ledgerSrc = ledgerSources[0];
  if (ledgerSrc && ledgerSrc.text !== null) {
    try {
      ledger = parseLedger(ledgerSrc.text, `${LEDGER_WHERE}.`);
    } catch (err) {
      if (!(err instanceof ModelError)) throw err;
      issues.push(...err.issues);
    }
  }

  const resolveLedgerRef = (ref: LedgerRef): ReturnType<Parameters<typeof evaluateStatus>[0]['resolve']> => {
    if (isUnsafePath(ref.path)) return { ok: false, code: 'E_PATH', reason: `절대경로거나 볼트 밖이다: ${ref.path}` };
    const text = input.readFile(ref.path);
    if (text === null) return { ok: false, code: 'E_LEDGER', reason: `증거 파일이 없다: ${ref.path}` };
    const known = sources.get(pathToId.get(ref.path) ?? '');
    let headings: Heading[];
    if (known && known.headings.length > 0) headings = known.headings;
    else {
      const split = splitFrontmatter(text);
      const offset = split.bodyStartLine - 1;
      headings = extractHeadings(split.body).map((h) => ({ ...h, line: h.line + offset }));
    }
    const r = resolveRef(ref, text, headings);
    if (!r.ok) return { ok: false, code: 'E_REF_UNRESOLVED', reason: r.reason };
    return { ok: true, source: pathToId.get(ref.path), slug: r.slug, line: r.line };
  };

  const evaluated = evaluateStatus({
    ledger,
    ledgerWhere: LEDGER_WHERE,
    viewerStatuses: viewer.statuses,
    stages: stageSpecs,
    resolve: resolveLedgerRef,
  });
  issues.push(...evaluated.issues);

  const ok = !issues.some((i) => i.level === 'error');
  if (!ok) return { ok, issues };
  return { ok, issues, viewer, ledger, status: evaluated.status, inheritedEvidence, unverifiedCode };
}

// after 그래프의 순환 하나를 찾아 경로로 돌려준다(없으면 null). 끊긴 id는 E_BROKEN_REF가 따로 본다.
function findAfterCycle(stages: { id: string; after?: string[] }[]): string[] | null {
  const deps = new Map(stages.map((s) => [s.id, s.after ?? []]));
  const state = new Map<string, 'open' | 'closed'>();
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 'closed') return null;
    if (state.get(id) === 'open') return [...path.slice(path.indexOf(id)), id];
    state.set(id, 'open');
    path.push(id);
    for (const next of deps.get(id) ?? []) {
      if (!deps.has(next)) continue;
      const found = visit(next);
      if (found) return found;
    }
    path.pop();
    state.set(id, 'closed');
    return null;
  };
  for (const s of stages) {
    const found = visit(s.id);
    if (found) return found;
  }
  return null;
}

function hasCycle(nodes: { id: string; parent?: string }[]): boolean {
  const parentOf = new Map<string, string | undefined>(nodes.map((n) => [n.id, n.parent]));
  for (const node of nodes) {
    const seen = new Set<string>([node.id]);
    let cur = parentOf.get(node.id);
    while (cur !== undefined) {
      if (seen.has(cur)) return true;
      seen.add(cur);
      if (!parentOf.has(cur)) break; // 끊긴 parent는 E_BROKEN_REF가 따로 본다
      cur = parentOf.get(cur);
    }
  }
  return false;
}
