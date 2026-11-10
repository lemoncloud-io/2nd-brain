// "이 PR 로 보기": 바뀐 파일 목록을 읽고, 지금 문서가 그 안에 없으면 첫 바뀐 md 로 옮긴다. PrPanel 의 enterPr 와 같은 규칙.
// 검색 상자의 PR 번호 입력(오너 요청 2026-10-27)이 같은 길을 쓰도록 떼어 놓았다. 목록을 못 읽으면 소스만 바꾸고 머문다.
import type { Source } from '../../shared/source.ts';
import { getPrChanges } from './api.ts';
import { firstChangedMd } from './source-ui.ts';
import { beginSourceSwitch } from './useSourceSwitch.ts';

export type EnterPrSinks = {
  onSource: (src: Source) => void;
  onNavigate: (path: string, anchor: undefined, src: Source) => void;
};

export async function enterPr(number: number, current: () => string, sinks: EnterPrSinks): Promise<void> {
  const next: Source = { kind: 'pr', number };
  const from = current();
  // 변경 목록(gh)을 기다리는 동안 "PR #n 불러오는 중…"을 띄운다.
  beginSourceSwitch(next);
  try {
    const c = await getPrChanges(number);
    const now = current();
    const target = now !== from ? null : firstChangedMd(c.files, now);
    if (target === null) sinks.onSource(next);
    else sinks.onNavigate(target, undefined, next);
  } catch {
    sinks.onSource(next);
  }
}
