// 단축키가 다른 컴포넌트의 내부 상태(⚙ 메뉴 열림·도움말 열림)를 움직이는 작은 알림 통로.
// 상단바·설정 메뉴의 props 를 늘리지 않으려고 둔다(병렬 PR 이 같은 props 블록을 고쳐 충돌하지 않게).
/** `view:<id>` 는 확장 화면 열기(상단바가 듣는다). */
export type ShortcutEvent = 'settings' | 'help' | 'search' | 'pr-search' | `view:${string}`;

const listeners = new Map<ShortcutEvent, Set<() => void>>();

export function emitShortcutEvent(name: ShortcutEvent): void {
  for (const cb of [...(listeners.get(name) ?? [])]) cb();
}

export function onShortcutEvent(name: ShortcutEvent, cb: () => void): () => void {
  let set = listeners.get(name);
  if (set === undefined) {
    set = new Set();
    listeners.set(name, set);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
  };
}
