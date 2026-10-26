import type { Source } from '../../shared/source.ts';
import { badgeText, staleness } from './source-ui.ts';
import type { VaultInfo } from './types.ts';

type Props = {
  info: VaultInfo | null;
  src: Source;
  /** 지금 보는 커밋의 짧은 oid. 문서를 읽었으면 doc.head, 아니면 info 의 main 머리. */
  head: string | null;
  /** main 을 못 써 local 로 떨어졌을 때 그 까닭. */
  fallbackReason?: string | null;
  /** pr 소스: 변경 목록을 못 읽은 까닭(알면). */
  srcReason?: string | null;
  /** 지금 시각(시험이 준다). */
  now?: number;
};

export type BadgeRow = { k: string; v: string; mono?: boolean };

/** 배지 마우스 오버 카드의 줄들. 순수 — 시험이 본다. */
export function badgeRows(info: VaultInfo, src: Source, head: string | null, opts: { fallbackReason?: string | null; srcReason?: string | null; now: number }): BadgeRow[] {
  const branch = info.branch ?? '(git 아님)';
  const text = badgeText(src, head);
  const rows: BadgeRow[] = [{ k: '볼트', v: info.name, mono: false }];
  if (text !== null) {
    const st = src.kind === 'main' ? staleness(info.sources?.main, opts.now) : { suffix: null, lines: [] as string[] };
    rows.push({ k: '소스', v: text });
    for (const l of st.lines) {
      const i = l.indexOf(': ');
      rows.push(i > 0 ? { k: l.slice(0, i), v: l.slice(i + 2), mono: false } : { k: '상태', v: l, mono: false });
    }
    if (src.kind === 'pr' && opts.srcReason) rows.push({ k: '변경 목록을 못 읽었다', v: opts.srcReason, mono: false });
    rows.push({ k: '워크트리 브랜치', v: branch });
  } else {
    rows.push({ k: '브랜치', v: branch });
  }
  if (info.head) rows.push({ k: '커밋', v: info.head });
  rows.push({ k: '체크아웃', v: info.worktree ? '워크트리' : '메인 체크아웃', mono: false });
  rows.push({ k: '상태', v: info.dirty ? '수정 중인 파일 있음' : '깨끗함', mono: false });
  if (text === null && opts.fallbackReason) rows.push({ k: '폴백', v: `메인을 못 열어 로컬로 열었다: ${opts.fallbackReason}`, mono: false });
  return rows;
}

function Tip({ rows }: { rows: BadgeRow[] }) {
  return (
    <dl className="badge-tip" role="tooltip">
      {rows.map((r) => (
        <div key={r.k} style={{ display: 'contents' }}>
          <dt>{r.k}</dt>
          <dd className={r.mono === false ? 'badge-tip-text' : undefined}>{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * 상단 오른쪽 귀퉁이: 지금 보는 볼트가 어느 워크트리·브랜치인지, git 소스면 어느 커밋인지.
 * 배지는 짧고(브랜치는 줄임표), 마우스를 올리면 카드에 전부 보인다. 키보드로도 닿게 tabIndex 를 둔다.
 */
export function VaultBadge({ info, src, head, fallbackReason, srcReason, now = Date.now() }: Props) {
  if (info === null) return null;
  const branch = info.branch ?? '(git 아님)';
  const text = badgeText(src, head);
  const rows = badgeRows(info, src, head, { fallbackReason, srcReason, now });
  const title = rows.map((r) => `${r.k}: ${r.v}`).join('\n');
  if (text !== null) {
    const st = src.kind === 'main' ? staleness(info.sources?.main, now) : { suffix: null };
    return (
      <span className="badge-wrap" tabIndex={0} aria-label={title}>
        <span className={`vault-badge vault-badge-src vault-badge-${src.kind}`} data-vault-branch={branch} data-vault-source={src.kind}>
          <span className="vault-badge-branch">{text}</span>
          {st.suffix === null ? null : <span className="vault-badge-stale">{st.suffix}</span>}
        </span>
        <Tip rows={rows} />
      </span>
    );
  }
  return (
    <span className="badge-wrap" tabIndex={0} aria-label={title}>
      <span className={info.worktree ? 'vault-badge vault-badge-wt' : 'vault-badge'} data-vault-branch={branch}>
        <span className="vault-badge-name">{info.worktree ? '⎇ ' : ''}{info.name}</span>
        <span className="vault-badge-branch">{branch}</span>
        {info.dirty ? <span className="vault-badge-dirty" aria-label="수정 중">●</span> : null}
      </span>
      <Tip rows={rows} />
    </span>
  );
}
