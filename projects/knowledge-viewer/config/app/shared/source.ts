// 문서를 읽어 오는 소스. 브라우저·서버 공용이다(node:* 를 쓰지 않는다).
export type Source = { kind: 'local' } | { kind: 'main' } | { kind: 'pr'; number: number };

export const MAIN: Source = { kind: 'main' };
export const LOCAL: Source = { kind: 'local' };

/** `main` · `local` · `pr:<1~9자리 숫자>` 만 받는다. 그 밖은 null. */
export function parseSource(s: string | null | undefined): Source | null {
  if (s === 'main') return MAIN;
  if (s === 'local') return LOCAL;
  if (typeof s !== 'string') return null;
  const m = /^pr:(\d{1,9})$/.exec(s);
  if (m === null) return null;
  return { kind: 'pr', number: Number(m[1]) };
}

export function sourceKey(s: Source): string {
  return s.kind === 'pr' ? `pr:${s.number}` : s.kind;
}
