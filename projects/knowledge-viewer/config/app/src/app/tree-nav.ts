// 트리 키보드 탐색. Tree.tsx 를 고치지 않고 그 DOM(행은 a.tree-row·button.tree-row, 폴더는 li[aria-expanded] > button + ul)을 읽어 포커스를 옮긴다.
// 트리 밖에서 j·k 를 누르면 현재 문서 행(없으면 첫 행)으로 들어온다. 화살표는 포커스가 트리 안일 때만 잡는다(문서 스크롤을 뺏지 않는다).

const ROW = 'a.tree-row, button.tree-row';

/** 다음 위치. 끝에서 멈춘다(돌지 않는다). cur 가 -1 이면 첫·끝으로. */
export function stepIndex(len: number, cur: number, dir: 1 | -1): number {
  if (len === 0) return -1;
  if (cur < 0) return dir === 1 ? 0 : len - 1;
  return Math.min(len - 1, Math.max(0, cur + dir));
}

function treeRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.col-left .tree');
}

function visibleRows(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(ROW)].filter((el) => el.getClientRects().length > 0);
}

function focusRow(el: HTMLElement | undefined | null): boolean {
  if (el === undefined || el === null) return false;
  el.focus();
  el.scrollIntoView({ block: 'nearest' });
  return true;
}

/** 포커스가 트리 안의 행인가. */
function currentRow(root: HTMLElement): HTMLElement | null {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement) || !root.contains(a)) return null;
  return a.closest<HTMLElement>(ROW);
}

/** 폴더 행이면 펼침 상태(true·false), 아니면 null. aria-expanded 는 li(폴더)나 단추(북마크 머리)에 있다. */
function expandedOf(row: HTMLElement): boolean | null {
  if (row.tagName !== 'BUTTON') return null;
  const v = row.getAttribute('aria-expanded') ?? row.closest('li')?.getAttribute('aria-expanded') ?? null;
  return v === null ? null : v === 'true';
}

/** 행을 담은 목록의 머리(폴더 단추·북마크 머리). 맨 위 목록이면 null. */
function parentRow(row: HTMLElement): HTMLElement | null {
  const list = row.closest('li')?.parentElement;
  const head = list?.previousElementSibling;
  return head instanceof HTMLElement && head.matches('button.tree-row') ? head : null;
}

/** j·↓ / k·↑. 트리 밖이면 j·k 만 트리로 들어오고 화살표는 false(기본 스크롤). */
export function treeMove(dir: 1 | -1, viaArrow: boolean): boolean {
  const root = treeRoot();
  if (root === null) return false;
  const rows = visibleRows(root);
  const cur = currentRow(root);
  if (cur === null) {
    if (viaArrow) return false;
    return focusRow(root.querySelector<HTMLElement>('.tree-current') ?? rows[0]);
  }
  return focusRow(rows[stepIndex(rows.length, rows.indexOf(cur), dir)]);
}

/** → 펴기(편 폴더면 첫 자식) / ← 접기(접힌 폴더·파일이면 상위 폴더). 트리 밖이면 false. */
export function treeSide(dir: 1 | -1): boolean {
  const root = treeRoot();
  if (root === null) return false;
  const cur = currentRow(root);
  if (cur === null) return false;
  const exp = expandedOf(cur);
  if (dir === 1) {
    if (exp === false) {
      cur.click();
      return true;
    }
    if (exp === true) {
      const rows = visibleRows(root);
      return focusRow(rows[rows.indexOf(cur) + 1]) || true;
    }
    return true;
  }
  if (exp === true) {
    cur.click();
    return true;
  }
  focusRow(parentRow(cur));
  return true;
}
