// 패널 켜기·순서·접힘 설정. 순수 모듈이다 — DOM 을 만지지 않고 storage 는 인자로 받는다.
// 설정은 브라우저(localStorage)에만 남고 볼트에는 적지 않는다.
export type PanelPrefs = { order: string[]; off: string[]; collapsed: string[] };

export const PREFS_KEY = 'knowledge-viewer.panels';

/**
 * 기본값의 세대. 등록부의 기본 순서·켜기를 바꿀 때 올린다 — 저장값에 이 번호가 없거나 다르면 기본값으로 돌아간다.
 * 사용자가 손수 바꾼 순서를 지우는 셈이니, 기본 배치를 바꾸는 결정이 있을 때만 올린다(2 = 2026-10-24 지도·목차·역링크 순, 북마크 끔, PR·뷰어 접힘).
 */
export const PREFS_VERSION = 2;

type PanelLike = { id: string; defaultOn?: boolean; defaultCollapsed?: boolean };

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function defaults(panels: PanelLike[]): PanelPrefs {
  return {
    order: panels.map((p) => p.id),
    off: panels.filter((p) => p.defaultOn === false).map((p) => p.id),
    collapsed: panels.filter((p) => p.defaultCollapsed === true).map((p) => p.id),
  };
}

/**
 * 저장된 값을 등록부에 맞춘다. 모르는 id 는 버리고, 빠진 id 는 등록부에서 가장 가까운 앞 패널(이미 순서에 있는 것)
 * 바로 뒤에 끼운다. 그런 앞 패널이 없으면 끝에 붙인다.
 * 모양이 틀리면(객체·문자열 배열이 아니면) 기본값이다. 그래서 패널을 더하거나 빼도 설정이 깨지지 않는다.
 */
export function normalizePrefs(raw: unknown, panels: PanelLike[]): PanelPrefs {
  if (typeof raw !== 'object' || raw === null) return defaults(panels);
  const { v, order, off, collapsed: rawCollapsed } = raw as { v?: unknown; order?: unknown; off?: unknown; collapsed?: unknown };
  if (v !== PREFS_VERSION) return defaults(panels);
  if (!isStringArray(order) || !isStringArray(off)) return defaults(panels);
  // 접힘은 나중에 생긴 필드다. 없거나 틀리면 등록부의 기본 접힘.
  const collapsed = isStringArray(rawCollapsed) ? [...rawCollapsed] : defaults(panels).collapsed;
  const known = new Set(panels.map((p) => p.id));
  const seen = new Set<string>();
  const outOrder: string[] = [];
  for (const id of order) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      outOrder.push(id);
    }
  }
  panels.forEach((p, i) => {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      let at = outOrder.length;
      for (let j = i - 1; j >= 0; j--) {
        const k = outOrder.indexOf(panels[j]!.id);
        if (k >= 0) {
          at = k + 1;
          break;
        }
      }
      outOrder.splice(at, 0, p.id);
      // 저장 뒤에 새로 생긴 패널은 defaultOn·defaultCollapsed 를 따른다.
      if (p.defaultOn === false && !off.includes(p.id)) off.push(p.id);
      if (p.defaultCollapsed === true && !collapsed.includes(p.id)) collapsed.push(p.id);
    }
  });
  const dedupe = (xs: string[]) => xs.filter((id, i) => known.has(id) && xs.indexOf(id) === i);
  return { order: outOrder, off: dedupe(off), collapsed: dedupe(collapsed) };
}

const defaultStorage = (): Storage | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

export function loadPrefs(panels: PanelLike[], storage: Pick<Storage, 'getItem'> | undefined = defaultStorage()): PanelPrefs {
  if (!storage) return defaults(panels);
  try {
    const text = storage.getItem(PREFS_KEY);
    return normalizePrefs(text === null ? null : JSON.parse(text), panels);
  } catch {
    return defaults(panels);
  }
}

export function savePrefs(prefs: PanelPrefs, storage: Pick<Storage, 'setItem'> | undefined = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(PREFS_KEY, JSON.stringify({ v: PREFS_VERSION, ...prefs }));
  } catch {
    // 저장소가 막혀 있다(비공개 창·용량). 설정은 이 세션 안에서만 산다.
  }
}

export function visiblePanels<T extends PanelLike>(panels: T[], prefs: PanelPrefs): T[] {
  const byId = new Map(panels.map((p) => [p.id, p]));
  const out: T[] = [];
  for (const id of prefs.order) {
    const p = byId.get(id);
    if (p && !prefs.off.includes(id)) out.push(p);
  }
  return out;
}

export function movePanel(prefs: PanelPrefs, id: string, dir: -1 | 1): PanelPrefs {
  const i = prefs.order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= prefs.order.length) return prefs;
  const order = [...prefs.order];
  [order[i], order[j]] = [order[j]!, order[i]!];
  return { ...prefs, order };
}

export function togglePanel(prefs: PanelPrefs, id: string): PanelPrefs {
  return { ...prefs, off: prefs.off.includes(id) ? prefs.off.filter((x) => x !== id) : [...prefs.off, id] };
}

/** 패널 본문을 접고 편다. 접힘은 켜기와 별개다 — 접힌 패널은 제목만 보인다. */
export function toggleCollapsed(prefs: PanelPrefs, id: string): PanelPrefs {
  return { ...prefs, collapsed: prefs.collapsed.includes(id) ? prefs.collapsed.filter((x) => x !== id) : [...prefs.collapsed, id] };
}

export function isCollapsed(prefs: PanelPrefs, id: string): boolean {
  return prefs.collapsed.includes(id);
}
