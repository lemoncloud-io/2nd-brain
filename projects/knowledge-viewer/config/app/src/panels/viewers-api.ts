// 뷰어 모음 패널의 응답 형식과 순수 함수. 서버(server/panels/viewers.ts)의 ViewersResult 와 같은 모양이다.
import { LOCAL } from '../../shared/source.ts';
import { frameOrigin, frameUrl } from '../reader/frame.ts';

export type ViewerStatus = 'ok' | 'missing' | 'up' | 'down' | 'manual';
export type ViewerOpen =
  /** spec: 프로젝트 뷰어의 viewer.yml(있을 때만). 있으면 새 탭 대신 볼트 뷰어 안의 통합 보기로 연다. */
  | { kind: 'static'; path: string; ask: string | null; spec?: string }
  | { kind: 'server'; url: string | null; port: number | null; launch: string | null; ask: string };
export type Viewer = {
  id: string;
  title: string;
  description: string;
  skill: string;
  open: ViewerOpen;
  status: ViewerStatus;
  group: string | null;
};
export type ViewersResponse = { viewers: Viewer[]; fetchedAt: string; error: string | null };

export async function getViewers(refresh: boolean): Promise<ViewersResponse> {
  const res = await fetch(`/api/panels/viewers${refresh ? '?refresh=1' : ''}`);
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // 아래에서 상태 코드로 오류를 만든다.
  }
  if (!res.ok || typeof json !== 'object' || json === null || !Array.isArray((json as { viewers?: unknown }).viewers)) {
    const msg = typeof json === 'object' && json !== null && 'error' in json ? String((json as { error: unknown }).error) : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as ViewersResponse;
}

/**
 * 항목을 눌렀을 때 할 일.
 * - inline: 프로젝트 뷰어의 viewer.yml 을 이 화면 안(통합 보기)에서 연다(앱 안 이동, 새 탭 아님).
 * - open: 새 탭으로 href 를 연다. static 은 디스크 /raw 를 localhost 출처(같은 포트)로 — 서버가 127.0.0.1 의 능동 콘텐츠를 그리로 보내는 것과 같은 곳이다.
 *   포트가 '' 이면(개인 이름 뒤, /api/info 전) 같은 출처 /raw 다 — 서버가 진짜 포트의 localhost 로 302 한다.
 * - ask: 서버가 꺼졌거나(down), 클로드만 띄울 수 있거나(manual), 파일이 없다(missing). ask 문장을 복사한다.
 * - none: 할 것이 없다(파일 없음 + 요청 문장 없음).
 */
export type ViewerAction =
  | { kind: 'open'; href: string }
  | { kind: 'inline'; spec: string }
  | { kind: 'ask'; text: string; reason: string }
  | { kind: 'none'; reason: string };

export function viewerAction(v: Viewer, port: string): ViewerAction {
  const o = v.open;
  // 프로젝트 뷰어는 viewer.yml 이 있으면 이 화면 안(통합 보기)에서 연다 — 산출물·새 탭이 필요 없다.
  if (o.kind === 'static' && o.spec !== undefined) return { kind: 'inline', spec: o.spec };
  if (o.kind === 'static') {
    if (v.status === 'ok') return { kind: 'open', href: frameUrl(port === '' ? '' : frameOrigin('localhost', port, LOCAL), o.path, '', LOCAL) };
    return o.ask === null ? { kind: 'none', reason: '파일 없음' } : { kind: 'ask', text: o.ask, reason: '파일 없음' };
  }
  if (v.status === 'up' && o.url !== null) return { kind: 'open', href: o.url };
  return { kind: 'ask', text: o.ask, reason: v.status === 'manual' ? '클로드가 띄운다' : '서버 꺼짐' };
}

/** 상태 점의 말. 화면 낭독기와 title 이 쓴다. */
export const STATUS_LABEL: Record<ViewerStatus, string> = {
  ok: '파일 있음',
  missing: '파일 없음',
  up: '서버 켜짐',
  down: '서버 꺼짐',
  manual: '클로드가 띄운다',
};

/** 클립보드에 쓴다. 보안 문맥(127.0.0.1)이면 navigator.clipboard, 안 되면 textarea + execCommand. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
