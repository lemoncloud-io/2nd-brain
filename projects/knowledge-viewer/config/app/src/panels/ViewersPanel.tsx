// 뷰어 모음 패널. 볼트의 뷰어 스킬(등록부 projects/knowledge-viewer/viewers.yml)을 버튼으로 모아
// 누르면 새 탭에서 바로 연다. 서버가 꺼졌으면 요청 문장을 복사해 클로드에게 맡긴다 — 이 화면은 명령을 실행하지 않는다.
import { useCallback, useEffect, useRef, useState } from 'react';

import { IconBook, IconExternal, IconPlay, IconRefresh } from '../app/icons.tsx';
import { isPlainClick } from '../app/links.ts';
import { hrefFor, type NavigateFn } from '../app/route.ts';
import { LOCAL } from '../../shared/source.ts';
import { STATUS_LABEL, copyText, getViewers, viewerAction, type Viewer, type ViewersResponse } from './viewers-api.ts';

const TOAST_MS = 2_500;

export type ViewersPanelProps = {
  agent: boolean;
  navigate: NavigateFn;
  /** 시험이 준다. 없으면 서버가 받아 온다. */
  initial?: ViewersResponse;
  /** 뷰어 서버 포트(static 의 /raw 주소). 없으면 지금 창의 포트. */
  port?: string;
};

export function ViewersPanel({ agent, navigate, initial, port }: ViewersPanelProps) {
  const [data, setData] = useState<ViewersResponse | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const live = useRef(true);
  const toastTimer = useRef<number | null>(null);
  const here = port ?? (typeof window === 'undefined' ? '' : window.location.port);

  const load = useCallback(async (refresh: boolean) => {
    setBusy(true);
    try {
      const d = await getViewers(refresh);
      if (live.current) setData(d);
    } catch (e) {
      if (live.current) setData({ viewers: [], fetchedAt: '', error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (live.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    live.current = true;
    if (initial === undefined) void load(false);
    return () => {
      live.current = false;
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, [load, initial]);

  const say = (msg: string) => {
    setToast(msg);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  };

  const ask = async (text: string) => {
    const ok = await copyText(text);
    say(ok ? '복사됨 — 클로드 입력창에 붙여 넣으세요' : `복사 실패 — 클로드에게 "${text}" 라고 말하세요`);
  };

  let lastGroup: string | null = null;
  return (
    <div className="viewers">
      <div className="viewers-head">
        <span className="viewers-count">{data === null ? '' : `${data.viewers.length}개`}</span>
        <button type="button" className="viewers-refresh" onClick={() => void load(true)} disabled={busy} aria-label="새로 고침" title="새로 고침">
          <IconRefresh size={14} />
        </button>
      </div>
      {data?.error != null && <p className="panel-empty viewers-error">{data.error}</p>}
      {data === null ? (
        <p className="panel-empty">불러오는 중…</p>
      ) : data.viewers.length === 0 ? (
        data.error === null && <p className="panel-empty">등록된 뷰어 없음</p>
      ) : (
        <ul className="viewers-grid">
          {data.viewers.map((v) => {
            const head = v.group !== null && v.group !== lastGroup ? v.group : null;
            lastGroup = v.group;
            return [
              head === null ? null : (
                <li key={`g:${head}`} className="viewers-group">
                  {head}
                </li>
              ),
              <ViewerCard key={v.id} v={v} port={here} agent={agent} navigate={navigate} onAsk={(t) => void ask(t)} />,
            ];
          })}
        </ul>
      )}
      {toast !== null && (
        <p className="viewers-toast" role="status">
          {toast}
        </p>
      )}
    </div>
  );
}

function ViewerCard({ v, port, agent, navigate, onAsk }: { v: Viewer; port: string; agent: boolean; navigate: NavigateFn; onAsk: (text: string) => void }) {
  const act = viewerAction(v, port);
  const off = act.kind !== 'open';
  const body = (
    <>
      <span className="viewer-icon" aria-hidden="true">
        <IconPlay size={14} />
      </span>
      <span className="viewer-text">
        <span className="viewer-title">
          {v.title}
          <span className={`viewer-dot viewer-dot-${v.status}`} title={STATUS_LABEL[v.status]} aria-label={STATUS_LABEL[v.status]} role="img" />
        </span>
        <span className="viewer-desc">{v.description}</span>
      </span>
      {act.kind === 'open' && (
        <span className="viewer-ext" aria-hidden="true">
          <IconExternal size={13} />
        </span>
      )}
    </>
  );
  return (
    <li className={['viewer', `viewer-${v.status}`, off ? 'viewer-off' : ''].filter(Boolean).join(' ')} data-viewer-id={v.id}>
      {act.kind === 'open' ? (
        <a className="viewer-main" href={act.href} target="_blank" rel="noopener noreferrer" title={`새 탭으로 열기 — ${act.href}`}>
          {body}
        </a>
      ) : (
        <span className="viewer-main" aria-disabled="true" title={act.reason}>
          {body}
        </span>
      )}
      <div className="viewer-foot">
        {off && <span className="viewer-note">{act.reason}</span>}
        {act.kind === 'ask' && (
          <button type="button" className="viewer-ask" onClick={() => onAsk(act.text)} title={`복사: ${act.text}`}>
            클로드에게 요청
          </button>
        )}
        <a
          className="viewer-guide"
          href={hrefFor(v.skill, undefined, agent, LOCAL)}
          data-vault-path={v.skill}
          title={v.skill}
          onClick={(e) => {
            if (!isPlainClick(e)) return;
            e.preventDefault();
            navigate(v.skill, undefined, LOCAL);
          }}
        >
          <IconBook size={13} />
          지침서
        </a>
      </div>
    </li>
  );
}
