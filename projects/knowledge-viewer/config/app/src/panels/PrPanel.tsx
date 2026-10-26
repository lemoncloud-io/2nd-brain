// 진행 중 PR 패널. 번호·제목·담당자를 보여 주고, 행을 펼치면 그 PR 이 바꾼 볼트 md 를 리더로 잇는다.
// 데이터는 서버(/api/panels/prs*)가 gh 로 읽는다. 이 컴포넌트는 토큰을 모른다.
import { useCallback, useEffect, useRef, useState } from 'react';

import { getPrChanges, getPrFiles, getPrRepos, getPrs } from '../app/api.ts';
import { isPlainClick } from '../app/links.ts';
import { hrefFor } from '../app/route.ts';
import { firstChangedMd } from '../app/source-ui.ts';
import type { Pr, PrFilesResponse, PrListResponse, Source } from '../app/types.ts';
import { formatUpdated, splitFiles } from './pr-format.ts';

const POLL_MS = 60_000;

export type PrPanelProps = {
  agent: boolean;
  /** 지금 경로. "이 PR 로 보기" 뒤 머물지 옮길지 가른다. */
  path: string;
  /** 지금 소스. 링크가 싣고, 같은 PR 행을 강조한다. */
  src: Source;
  onSource: (src: Source) => void;
  /** src 를 빼면 지금 소스를 유지한다. */
  onNavigate: (path: string, anchor?: string, src?: Source) => void;
};

type FilesState = 'loading' | PrFilesResponse;

export function PrPanel({ agent, path, src, onSource, onNavigate }: PrPanelProps) {
  const [repos, setRepos] = useState<string[]>([]);
  // 볼트 레포(origin). 이 레포 PR 행에만 "이 PR 로 보기"를 단다. 모르면 null(단추 없음).
  const [vaultRepo, setVaultRepo] = useState<string | null>(null);
  const [entering, setEntering] = useState<number | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;
  const [repo, setRepo] = useState<string | null>(null);
  const [data, setData] = useState<PrListResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const [files, setFiles] = useState<Map<number, FilesState>>(() => new Map());
  const live = useRef(true);
  const repoRef = useRef<string | null>(null);
  repoRef.current = repo;

  const openRef = useRef<Set<number>>(new Set());
  openRef.current = open;

  const fetchFiles = useCallback((number: number, refresh: boolean) => {
    const repo = repoRef.current;
    setFiles((m) => new Map(m).set(number, 'loading'));
    getPrFiles(repo, number, refresh).then(
      (f) => live.current && repoRef.current === repo && setFiles((m) => new Map(m).set(number, f)),
      (e: unknown) =>
        live.current &&
        repoRef.current === repo &&
        setFiles((m) => new Map(m).set(number, { repo, number, files: [], truncated: false, error: e instanceof Error ? e.message : String(e) })),
    );
  }, []);

  const load = useCallback(async (refresh: boolean) => {
    setBusy(true);
    const repo = repoRef.current;
    try {
      const d = await getPrs(repo, refresh);
      if (live.current && repoRef.current === repo) {
        setData(d);
        // 새로 고침은 펼쳐 둔 행의 파일 목록도 다시 읽는다. 보이는 것이 전부 새로워야 한다.
        if (refresh) {
          setFiles(new Map());
          for (const n of openRef.current) fetchFiles(n, true);
        }
      }
    } catch (e) {
      if (live.current) setData({ repo: repoRef.current, prs: [], truncated: false, fetchedAt: '', error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (live.current) setBusy(false);
    }
  }, [fetchFiles]);

  // 처음: 허용 레포 목록 → 첫 레포의 PR.
  useEffect(() => {
    live.current = true;
    getPrRepos().then(
      (r) => {
        if (!live.current) return;
        setRepos(r.repos);
        setVaultRepo(r.vaultRepo);
        if (r.error !== null && r.repos.length === 0) setData({ repo: null, prs: [], truncated: false, fetchedAt: '', error: r.error });
        else void load(false);
      },
      (e: unknown) => live.current && setData({ repo: null, prs: [], truncated: false, fetchedAt: '', error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live.current = false;
    };
  }, [load]);

  // 레포를 바꾸면 펼친 것을 접고 다시 읽는다.
  const changeRepo = (next: string) => {
    setRepo(next);
    repoRef.current = next;
    setOpen(new Set());
    setFiles(new Map());
    void load(false);
  };

  // 탭이 보이는 동안 60초마다. 숨으면 멈추고 다시 보이면 한 번 읽고 재개한다(SSE 와 같은 규칙).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let timer: number | null = null;
    const start = () => {
      if (timer !== null) return;
      timer = window.setInterval(() => void load(false), POLL_MS);
    };
    const stop = () => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') stop();
      else {
        void load(false);
        start();
      }
    };
    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      stop();
    };
  }, [load]);

  // 이 PR 로 보기: 바뀐 파일 목록을 먼저 읽고, 지금 문서가 그 안에 없으면 첫 바뀐 md 로 한 번에 옮긴다.
  // 목록을 못 읽거나 바뀐 md 가 없으면 소스만 바꾸고 머문다. 기다리는 사이 사용자가 다른 문서로 갔으면 그 문서에 머문다.
  const enterPr = (number: number) => {
    const next: Source = { kind: 'pr', number };
    const from = pathRef.current;
    setEntering(number);
    getPrChanges(number).then(
      (c) => {
        if (!live.current) return;
        setEntering(null);
        const now = pathRef.current;
        const target = now !== from ? null : firstChangedMd(c.files, now);
        if (target === null) onSource(next);
        else onNavigate(target, undefined, next);
      },
      () => {
        if (!live.current) return;
        setEntering(null);
        onSource(next);
      },
    );
  };

  const toggle = (pr: Pr) => {
    const next = new Set(open);
    if (next.has(pr.number)) next.delete(pr.number);
    else {
      next.add(pr.number);
      if (!files.has(pr.number)) fetchFiles(pr.number, false);
    }
    setOpen(next);
  };

  return (
    <div className="prs">
      <div className="pr-head">
        {repos.length > 1 ? (
          <select className="pr-repo" aria-label="레포" value={repo ?? repos[0]} onChange={(e) => changeRepo(e.target.value)}>
            {repos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        ) : (
          <span className="pr-repo">{data?.repo ?? repos[0] ?? ''}</span>
        )}
        <button type="button" className="pr-refresh" onClick={() => void load(true)} disabled={busy} aria-label="새로 고침">
          {busy ? '…' : '새로 고침'}
        </button>
      </div>
      {data === null ? (
        <p className="panel-empty">불러오는 중…</p>
      ) : data.error !== null ? (
        <p className="panel-empty">{data.error}</p>
      ) : data.prs.length === 0 ? (
        <p className="panel-empty">열린 PR 없음</p>
      ) : (
        <ul className="pr-list">
          {data.prs.map((pr) => {
            const ofVault = vaultRepo !== null && data.repo === vaultRepo;
            const current = ofVault && src.kind === 'pr' && src.number === pr.number;
            return (
            <li
              key={pr.number}
              className={['pr-row', open.has(pr.number) ? 'pr-open' : '', current ? 'pr-current' : ''].filter(Boolean).join(' ')}
              aria-current={current ? 'true' : undefined}
            >
              <div className="pr-line">
                <a className="pr-num" href={pr.url} target="_blank" rel="noopener noreferrer" title="GitHub 에서 열기">
                  #{pr.number}
                </a>
                <button type="button" className="pr-title" onClick={() => toggle(pr)} aria-expanded={open.has(pr.number)} title={pr.title}>
                  {pr.title}
                </button>
              </div>
              <div className="pr-who">
                {pr.isDraft && <span className="pr-draft">초안</span>}
                {pr.assignees.length > 0 ? <span>{pr.assignees.join(', ')}</span> : <span className="pr-author">{pr.author}</span>}
                <span className="pr-when">{formatUpdated(pr.updatedAt, Date.now())}</span>
              </div>
              {ofVault && !agent && (
                <button
                  type="button"
                  className="pr-view"
                  disabled={current || entering === pr.number}
                  onClick={() => enterPr(pr.number)}
                  title={current ? '지금 이 PR 머리로 보고 있다' : 'PR 머리(head)의 볼트로 본다'}
                >
                  {current ? '이 PR 로 보는 중' : entering === pr.number ? '여는 중…' : '이 PR 로 보기'}
                </button>
              )}
              {open.has(pr.number) && (
                // 볼트 레포 PR 의 파일은 그 PR 머리로 연다(지금 소스가 아니라). 다른 레포는 지금 소스.
                <PrFiles state={files.get(pr.number) ?? 'loading'} agent={agent} src={ofVault ? { kind: 'pr', number: pr.number } : src} onNavigate={onNavigate} />
              )}
            </li>
            );
          })}
        </ul>
      )}
      {data !== null && data.truncated && <p className="panel-empty">목록이 잘렸다 (100개까지)</p>}
      {data !== null && data.fetchedAt !== '' && <p className="pr-foot">갱신 {formatUpdated(data.fetchedAt, Date.now())}</p>}
    </div>
  );
}

function PrFiles({ state, agent, src, onNavigate }: { state: FilesState; agent: boolean; src: Source; onNavigate: (path: string, anchor?: string, src?: Source) => void }) {
  if (state === 'loading') return <p className="panel-empty pr-files">불러오는 중…</p>;
  if (state.error !== null) return <p className="panel-empty pr-files">{state.error}</p>;
  const { viewable, missing, otherCount } = splitFiles(state.files);
  if (viewable.length === 0 && missing.length === 0) return <p className="panel-empty pr-files">바뀐 md 없음{otherCount > 0 ? ` · md 외 ${otherCount}개` : ''}</p>;
  return (
    <div className="pr-files">
      <ul className="backlinks">
        {viewable.map((f) => (
          <li key={f.path}>
            <a
              href={hrefFor(f.path, undefined, agent, src)}
              data-vault-path={f.path}
              onClick={(e) => {
                if (!isPlainClick(e)) return;
                e.preventDefault();
                onNavigate(f.path, undefined, src);
              }}
            >
              <span className="backlink-path">{f.path}</span>
            </a>
          </li>
        ))}
        {missing.map((f) => (
          <li key={f.path} className="pr-file-missing">
            <span className="backlink-path">{f.path}</span>
            <span className="pr-file-note">체크아웃에 없음</span>
          </li>
        ))}
      </ul>
      {(otherCount > 0 || state.truncated) && (
        <p className="pr-file-more">
          {otherCount > 0 ? `md 외 ${otherCount}개` : ''}
          {otherCount > 0 && state.truncated ? ' · ' : ''}
          {state.truncated ? '목록이 잘렸다' : ''}
        </p>
      )}
    </div>
  );
}
