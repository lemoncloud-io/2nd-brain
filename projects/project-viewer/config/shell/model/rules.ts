// 상태 원장 규칙 (docs/schema.md § status.yml 1~8). 파일은 읽지 않는다 — 해소는 주입받는다.
import type { Issue, LedgerDoc, LedgerEntry, LedgerRef, StatusDef, StatusView } from './types.ts';

const NO_ORIGIN_LABEL = '상태 근거 미등록';

export interface ResolvedLedgerRef {
  ok: true;
  source?: string;
  slug?: string;
  line?: number;
}
export interface FailedLedgerRef {
  ok: false;
  code: 'E_LEDGER' | 'E_REF_UNRESOLVED' | 'E_PATH';
  reason: string;
}
export type LedgerRefResolver = (ref: LedgerRef) => ResolvedLedgerRef | FailedLedgerRef;

export interface StageSpec {
  id: string;
  where: string; // viewer.yml 안의 위치
  /** `status_from`이 있을 때만. `value`는 그 문서 frontmatter의 status 값이다. */
  statusFrom?: { source: string; path: string; value: unknown };
  items: { id: string; required: boolean }[];
}

export interface EvaluateInput {
  ledger: LedgerDoc | null;
  ledgerWhere: string; // 예: 'ledger'
  viewerStatuses?: Record<string, StatusDef>;
  stages: StageSpec[];
  resolve: LedgerRefResolver;
}

export interface EvaluateOutput {
  status: Record<string, StatusView>;
  issues: Issue[];
}

/** 글롭은 `*`만 지원한다. 나머지 문자는 글자 그대로다. */
export function matchDefault(id: string, rules: { match: string; status: string }[] | undefined): string | null {
  for (const rule of rules ?? []) {
    const pattern = new RegExp(`^${rule.match.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '*' ? '.*' : `\\${c}`))}$`);
    if (pattern.test(id)) return rule.status;
  }
  return null;
}

function err(code: string, where: string, message: string): Issue {
  return { level: 'error', code, message, where };
}

/** 어휘의 표시 장식(motion·struck)을 선언한 것만 옮긴다 — 선언하지 않은 뷰어의 Bundle은 그대로다. */
function marks(def: StatusDef): Pick<StatusView, 'motion' | 'struck'> {
  return {
    ...(def.motion !== undefined ? { motion: def.motion } : {}),
    ...(def.struck === true ? { struck: true as const } : {}),
  };
}

function noneView(): StatusView {
  return { status: null, label: NO_ORIGIN_LABEL, tone: 'muted', done: false, origin: 'none', evidence: [] };
}

export function evaluateStatus(input: EvaluateInput): EvaluateOutput {
  const { ledger, ledgerWhere: lw, stages, resolve } = input;
  const issues: Issue[] = [];
  const vocab: Record<string, StatusDef> = ledger ? ledger.statuses : (input.viewerStatuses ?? {});
  const status: Record<string, StatusView> = {};

  // 규칙 3 — 기본값에는 완료 상태를 쓸 수 없다.
  if (ledger) {
    const def = vocab[ledger.default];
    if (!def) issues.push(err('E_LEDGER', `${lw}.default`, `어휘에 없는 상태: ${ledger.default}`));
    else if (def.done) issues.push(err('E_LEDGER', `${lw}.default`, '기본값에는 done: true인 상태를 쓸 수 없다'));
    (ledger.defaults ?? []).forEach((rule, i) => {
      const d = vocab[rule.status];
      if (!d) issues.push(err('E_LEDGER', `${lw}.defaults[${i}].status`, `어휘에 없는 상태: ${rule.status}`));
      else if (d.done) issues.push(err('E_LEDGER', `${lw}.defaults[${i}].status`, '기본값에는 done: true인 상태를 쓸 수 없다'));
    });
  }

  const stageIds = new Set(stages.map((s) => s.id));
  const itemIds = new Set(stages.flatMap((s) => s.items.map((it) => it.id)));

  // 규칙 5 — 원장에만 있는 id는 오류다.
  if (ledger) {
    for (const key of Object.keys(ledger.stages ?? {})) {
      if (!stageIds.has(key)) issues.push(err('E_LEDGER', `${lw}.stages.${key}`, 'viewer.yml에 없는 단계 id다'));
    }
    for (const key of Object.keys(ledger.items ?? {})) {
      if (!itemIds.has(key)) issues.push(err('E_LEDGER', `${lw}.items.${key}`, 'viewer.yml에 없는 항목 id다'));
    }
  }

  function fromEntry(kind: 'stages' | 'items', id: string, entry: LedgerEntry): StatusView {
    const where = `${lw}.${kind}.${id}`;
    const def = vocab[entry.status];
    if (!def) {
      issues.push(err('E_LEDGER', `${where}.status`, `어휘에 없는 상태: ${entry.status}`));
      return { status: entry.status, label: entry.status, tone: 'muted', done: false, note: entry.note, origin: 'ledger', evidence: [] };
    }
    const refs = entry.evidence ?? [];
    // 규칙 2 — 완료에는 증거가 1개 이상 필요하다.
    if (def.done === true && refs.length === 0) {
      issues.push(err('E_LEDGER', `${where}.evidence`, `done: true인 상태(${entry.status})에는 증거가 1개 이상 필요하다`));
    }
    const evidence: StatusView['evidence'] = [];
    refs.forEach((ref, i) => {
      const r = resolve(ref);
      if (!r.ok) {
        issues.push(err(r.code, `${where}.evidence[${i}]`, r.reason));
        evidence.push({ ...ref, resolved: { path: ref.path } });
        return;
      }
      evidence.push({ ...ref, resolved: { path: ref.path, source: r.source, slug: r.slug, line: r.line } });
    });
    return { status: entry.status, label: def.label, tone: def.tone, done: def.done === true, ...marks(def), note: entry.note, origin: 'ledger', evidence };
  }

  function fromDefault(id: string): StatusView {
    if (!ledger) return noneView();
    const name = matchDefault(id, ledger.defaults) ?? ledger.default;
    const def = vocab[name];
    if (!def) return { status: name, label: name, tone: 'muted', done: false, origin: 'ledger-default', evidence: [] };
    return { status: name, label: def.label, tone: def.tone, done: def.done === true, ...marks(def), origin: 'ledger-default', evidence: [] };
  }

  // 규칙 6 — status_from은 그 문서의 frontmatter status를 읽는다.
  function fromFrontmatter(stage: StageSpec): StatusView {
    const sf = stage.statusFrom!;
    const where = `${stage.where}.status_from`;
    const value = sf.value;
    if (typeof value !== 'string' || !vocab[value]) {
      issues.push(err('E_LEDGER', where, `frontmatter status가 어휘에 없다: ${String(value)}`));
      return noneView();
    }
    const def = vocab[value]!;
    // 그 상태가 완료면 증거는 그 문서 자체다.
    const evidence: StatusView['evidence'] =
      def.done === true ? [{ path: sf.path, resolved: { path: sf.path, source: sf.source } }] : [];
    return { status: value, label: def.label, tone: def.tone, done: def.done === true, ...marks(def), origin: 'frontmatter', evidence };
  }

  for (const stage of stages) {
    const entry = ledger?.stages?.[stage.id];
    let view: StatusView;
    if (stage.statusFrom) {
      if (entry) {
        // 한 단계의 상태를 두 진실원이 말하면 어느 쪽이 맞는지 알 수 없다.
        issues.push(err('E_LEDGER', `${stage.where}.status_from`, '같은 단계에 status_from과 원장 항목이 둘 다 있다'));
      }
      view = fromFrontmatter(stage);
    } else if (entry) {
      view = fromEntry('stages', stage.id, entry);
    } else {
      view = fromDefault(stage.id);
    }

    for (const item of stage.items) {
      const itemEntry = ledger?.items?.[item.id];
      status[item.id] = itemEntry ? fromEntry('items', item.id, itemEntry) : fromDefault(item.id);
    }

    // 규칙 4 — 단계가 완료이려면 필수 항목이 전부 완료여야 한다.
    if (view.done) {
      const blocking = stage.items.filter((it) => it.required && status[it.id]?.done !== true);
      if (blocking.length > 0) {
        const where = view.origin === 'ledger' ? `${lw}.stages.${stage.id}` : stage.where;
        issues.push(err('E_LEDGER', where, `필수 항목이 미완이다: ${blocking.map((b) => b.id).join(', ')}`));
      }
    }
    status[stage.id] = view;
  }

  return { status, issues };
}
