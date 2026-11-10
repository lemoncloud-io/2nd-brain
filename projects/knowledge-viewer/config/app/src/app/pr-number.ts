// ⚙ 소스 줄의 PR 번호 입력: 글을 번호로 읽고, 그 PR 이 있는지 물은 뒤에야 옮긴다. 순수(묻기·옮기기는 받는다).
// 검색 상자의 번호 점프와 달리 바로 옮기지 않는 까닭: 없는 번호로 소스를 바꾸면 화면이 빈 오류로 떨어진다 — 먼저 물어 자리에서 알린다.
import { parsePrJump } from './pr-jump.ts';

export type PrNumberSinks = {
  /** 그 PR 이 있는가. 없으면 던진다(기본은 /api/pr/<n>/changes — 없는 번호는 503). */
  check: (n: number) => Promise<unknown>;
  /** 옮긴다(App 의 enterPr). */
  go: (n: number) => void;
};

export type PrNumberResult = { ok: true; number: number } | { ok: false; message: string | null };

export async function submitPrNumber(text: string, { check, go }: PrNumberSinks): Promise<PrNumberResult> {
  if (text.trim() === '') return { ok: false, message: null };
  const n = parsePrJump(text);
  if (n === null) return { ok: false, message: '번호를 넣는다 — 예: 123 · #123' };
  try {
    await check(n);
  } catch {
    return { ok: false, message: `PR #${n} 을 찾지 못했다` };
  }
  go(n);
  return { ok: true, number: n };
}
