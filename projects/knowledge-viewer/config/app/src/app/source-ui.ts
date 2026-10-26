// 소스 선택 상자·배지의 순수 도우미. DOM 을 만지지 않는다.
import { sourceKey } from '../../shared/source.ts';
import type { Source } from '../../shared/source.ts';
import { formatUpdated } from '../panels/pr-format.ts';
import type { ChangedFile, PrChanges } from './types.ts';

export type SourceOption = { value: string; label: string; disabled?: boolean };

/** 선택 상자에 싣는 최근 PR 수. */
export const PR_OPTION_LIMIT = 20;
/** PR 제목을 자르는 글자 수. */
const TITLE_MAX = 40;

const MAIN_LABEL = '메인 (master)';
const LOCAL_LABEL = '로컬 (워크트리)';

const clip = (s: string): string => {
  const chars = Array.from(s);
  return chars.length > TITLE_MAX ? `${chars.slice(0, TITLE_MAX).join('')}…` : s;
};

export function labelOf(src: Source): string {
  if (src.kind === 'main') return MAIN_LABEL;
  if (src.kind === 'local') return LOCAL_LABEL;
  return `PR #${src.number}`;
}

/**
 * 선택 상자 항목: main · local · PR(최근 20개). main 을 못 쓰면 disabled.
 * `current` 가 목록에 없는 PR 이면 끝에 더해 선택 상자가 주소와 어긋나지 않게 한다.
 */
export function sourceOptions(prs: { number: number; title: string }[], mainAvailable: boolean, current?: Source): SourceOption[] {
  const out: SourceOption[] = [
    mainAvailable ? { value: 'main', label: MAIN_LABEL } : { value: 'main', label: MAIN_LABEL, disabled: true },
    { value: 'local', label: LOCAL_LABEL },
  ];
  for (const pr of prs.slice(0, PR_OPTION_LIMIT)) {
    out.push({ value: `pr:${pr.number}`, label: `PR #${pr.number} ${clip(pr.title)}` });
  }
  if (current !== undefined && current.kind === 'pr') {
    const key = sourceKey(current);
    if (!out.some((o) => o.value === key)) out.push({ value: key, label: labelOf(current) });
  }
  return out;
}

/** 상단 배지 글: main 은 `origin/master @ <head>`, pr 은 `PR #n @ <head>`. local 은 null(배지가 지금처럼 그린다). */
export function badgeText(src: Source, head: string | null): string | null {
  if (src.kind === 'local') return null;
  const name = src.kind === 'main' ? 'origin/master' : labelOf(src);
  return head === null || head === '' ? name : `${name} @ ${head}`;
}

const isLiveMd = (f: Pick<ChangedFile, 'path' | 'status'>): boolean => f.status !== 'D' && f.path.endsWith('.md');

/**
 * "이 PR 로 보기" 뒤 갈 곳. 현재 문서가 PR 이 바꾼(지우지 않은) md 면 null(머문다),
 * 아니면 그런 md 중 첫 것, 하나도 없으면 null.
 */
export function firstChangedMd(files: Pick<ChangedFile, 'path' | 'status'>[], current: string): string | null {
  const live = files.filter(isLiveMd);
  if (live.some((f) => f.path === current)) return null;
  return live[0]?.path ?? null;
}

/** PR 배지 글: `PR #n · <제목 앞 40글자>`(코드포인트로 센다). */
export function prBadgeText(c: Pick<PrChanges, 'number' | 'title'>): string {
  return `PR #${c.number} · ${clip(c.title)}`;
}

/**
 * PR 배지 끝의 머리: 실제로 읽은 커밋(headCommit — fetch 한 refs/kv/pr/<n>) 앞 7자. gh 의 headOid 가 아니다 —
 * fetch 가 늦거나 실패하면 둘이 다르다(prHeadLag). 에이전트 모드에도 글로 남아 어느 커밋을 읽는지 보인다.
 */
export function prBadgeHead(c: Pick<PrChanges, 'headCommit'>): string {
  return c.headCommit.slice(0, 7);
}

/** PR 배지 툴팁: `작성자 · head → base · <읽은 커밋 앞 8>`. */
export function prTooltip(c: Pick<PrChanges, 'author' | 'head' | 'base' | 'headCommit'>): string {
  return `${c.author} · ${c.head} → ${c.base} · ${c.headCommit.slice(0, 8)}`;
}

/**
 * 읽은 커밋이 gh 가 아는 PR 머리가 아니면(아직 fetch 전·fetch 실패) 짧은 표시와 툴팁. 같으면 null.
 * 비교는 gh 머리의 짧은 꼴(7자)로 한다. gh 가 머리를 주지 않았으면 비교하지 않는다.
 */
export function prHeadLag(c: Pick<PrChanges, 'headOid' | 'headCommit'>): { text: string; title: string } | null {
  if (c.headOid === '' || c.headCommit.startsWith(c.headOid.slice(0, 7))) return null;
  return { text: 'PR 머리 미반영', title: `gh 머리 ${c.headOid.slice(0, 8)} · 읽은 커밋 ${c.headCommit.slice(0, 8)}` };
}

/**
 * git 소스의 신선도(/api/info 의 sources.main 등). reason(마지막 fetch 실패)이 있으면 `(오래됨)` 꼬리와
 * 툴팁 줄을 준다. 가져온 때는 이 서버가 마지막으로 fetch 에 성공한 때다.
 */
export function staleness(st: { fetchedAt: number | null; reason?: string } | undefined, now: number): { suffix: string | null; lines: string[] } {
  if (st === undefined) return { suffix: null, lines: [] };
  const lines = [`가져온 때: ${st.fetchedAt === null ? '이 서버에서 받은 적 없음' : formatUpdated(new Date(st.fetchedAt).toISOString(), now)}`];
  if (st.reason === undefined || st.reason === '') return { suffix: null, lines };
  return { suffix: '(오래됨)', lines: [...lines, `갱신 실패: ${st.reason}`] };
}
