// 뷰어 모음 패널. 볼트의 뷰어 스킬(등록부 projects/knowledge-viewer/viewers.yml)을 버튼으로 모아
// 누르면 새 탭에서 바로 연다. 프로젝트 뷰어(viewer.yml 이 있는 것)는 새 탭 대신 이 화면 안의 통합 보기로 연다.
// 서버가 꺼졌으면 요청 문장을 복사해 클로드에게 맡긴다 — 이 화면은 명령을 실행하지 않는다.
import { useCallback, useEffect, useRef, useState } from 'react';

import { IconBook, IconExternal, IconPlay, IconRefresh } from '../app/icons.tsx';
import { isPlainClick } from '../app/links.ts';
import { appHref, hrefFor, type NavigateFn } from '../app/route.ts';
import { getApps, type AppEntry } from '../apps/api.ts';
import { AppIcon } from '../apps/app-icons.tsx';
import { APP_UIS, findAppUi, type ViewerAppUi } from '../apps/registry.ts';
import { LOCAL } from '../../shared/source.ts';
import { isNamedHost } from '../reader/frame.ts';
import { STATUS_LABEL, copyText, getViewers, viewerAction, type Viewer, type ViewersResponse } from './viewers-api.ts';

const TOAST_MS = 2_500;

export type ViewersPanelProps = {
  agent: boolean;
  navigate: NavigateFn;
  /** 시험이 준다. 없으면 서버가 받아 온다. */
  initial?: ViewersResponse;
  /** 뷰어 서버 포트(static 의 /raw 주소). 없으면 지금 창의 포트. */
  port?: string;
  /** /api/info 의 주 포트. 개인 이름 뒤면 창의 포트(프록시) 대신 이것이다. */
  rawPort?: number | null;
  /** 앱 플러그인 목록(/api/apps). 시험이 준다. 없으면 서버가 받아 온다. */
  apps?: AppEntry[];
  /** 앱 화면 등록부(아이콘). 빼면 실제 등록부(APP_UIS). 시험이 바꿔 끼운다. */
  appUis?: ViewerAppUi[];
};

export function ViewersPanel({ agent, navigate, initial, port, rawPort, apps: initialApps, appUis = APP_UIS }: ViewersPanelProps) {
  const [data, setData] = useState<ViewersResponse | null>(initial ?? null);
  // 앱 플러그인 항목. 못 받으면 비운다(뷰어 목록은 그대로).
  const [apps, setApps] = useState<AppEntry[]>(initialApps ?? []);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const live = useRef(true);
  const toastTimer = useRef<number | null>(null);
  // 개인 이름 뒤면 창의 포트는 프록시 것이다 — rawPort, 모르면 '' (viewerAction 이 같은 출처 /raw 로 짓는다).
  const here = port ?? (typeof window === 'undefined' ? '' : isNamedHost(window.location.hostname) ? (rawPort == null ? '' : String(rawPort)) : window.location.port);

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
    if (initialApps === undefined)
      getApps().then(
        (a) => live.current && setApps(a),
        () => {
          // 앱 목록이 없어도 패널은 산다.
        },
      );
    return () => {
      live.current = false;
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, [load, initial, initialApps]);

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
      {/* 앱 플러그인: 이 화면 안(/apps/<id>)에서 연다. 전체 페이지 이동이라 서버가 토큰 meta 를 넣는다. */}
      {apps.length > 0 && (
        <ul className="viewers-grid viewers-apps">
          <li className="viewers-group">앱</li>
          {apps.map((a) => (
            <AppCard key={`app:${a.id}`} app={a} agent={agent} appUis={appUis} />
          ))}
        </ul>
      )}
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
  const off = act.kind !== 'open' && act.kind !== 'inline';
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
      {act.kind === 'inline' ? (
        // 통합 보기: 앱 안 이동(디스크 소스). 수정키를 누르면 브라우저가 새 탭으로 연다.
        <a
          className="viewer-main"
          href={hrefFor(act.spec, undefined, agent, LOCAL)}
          data-vault-path={act.spec}
          title={`이 화면 안에서 열기 — ${act.spec}`}
          onClick={(e) => {
            if (!isPlainClick(e)) return;
            e.preventDefault();
            navigate(act.spec, undefined, LOCAL);
          }}
        >
          {body}
        </a>
      ) : act.kind === 'open' ? (
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

/** 앱 플러그인 항목 하나. 준비 안 된 앱(reason)도 열 수 있다 — 앱 화면이 503 사유를 보인다. */
function AppCard({ app, agent, appUis }: { app: AppEntry; agent: boolean; appUis: ViewerAppUi[] }) {
  // 아이콘은 화면 등록부에서 id 로 찾는다(/api/apps 응답엔 없다). 없으면 AppIcon 이 기본 아이콘을 그린다.
  const icon = findAppUi(appUis, app.id)?.icon ?? null;
  const status = app.ready ? 'up' : 'down';
  return (
    <li className={['viewer', `viewer-${status}`, app.ready ? '' : 'viewer-off'].filter(Boolean).join(' ')} data-app-id={app.id}>
      <a className="viewer-main" href={appHref(app.id, agent)} title={`이 화면 안에서 열기 — /apps/${app.id}`}>
        <span className="viewer-icon" aria-hidden="true">
          <AppIcon name={icon} size={14} />
        </span>
        <span className="viewer-text">
          <span className="viewer-title">
            {app.title}
            <span className={`viewer-dot viewer-dot-${status}`} title={app.ready ? '준비됨' : '쓸 수 없음'} aria-label={app.ready ? '준비됨' : '쓸 수 없음'} role="img" />
          </span>
          <span className="viewer-desc">{app.ready ? '통합 보기' : (app.reason ?? '쓸 수 없음')}</span>
        </span>
      </a>
    </li>
  );
}
