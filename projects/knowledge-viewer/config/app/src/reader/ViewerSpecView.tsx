// `viewer.yml`(project-viewer 셸의 스펙) 보기. 기본은 통합 보기 — 서버가 셸 collect 로 메모리에서 묶은 데이터(/api/project-viewer)를
// 셸 화면 컴포넌트(ProjectViewer)로 가운데 열 안에 바로 그린다. iframe·빌드 산출물을 거치지 않는다. 셸 라우트는 주소의 해시(`#/p/…`)다.
// 위 막대는 스펙(→ 산출물이 있으면 그 링크), 렌더·원문 토글, 산출물 새 탭, 경로 복사다. 원문은 기존 텍스트 파일 보기(FileView)다.
// viewer.yml 검사 오류면 오류 목록과 원문을 보인다. 셸을 못 불러오면(셸 의존성 없음 등) 산출물이 있을 때만 기존 html 틀(HtmlFrame)로 되돌린다.
// 에이전트 모드는 예전 그대로 텍스트다(산출물 주소 + 원문). 읽기 전용 — 빌드하지 않는다.
import { useEffect, useState, type ReactNode } from 'react';

import type { Issue, ProjectViewerResponse } from '../../shared/project-viewer.ts';
import { sourceKey, type Source } from '../../shared/source.ts';
import { viewerBuildCommand, viewerSpecOfOutput, type ViewerSpecResponse } from '../../shared/viewer-spec.ts';
import { getProjectViewer, getViewerSpec } from '../app/api.ts';
import { isPlainClick } from '../app/links.ts';
import { readViewerSpecMode, writeViewerSpecMode, type ViewerSpecMode } from '../app/prefs.ts';
import { hrefFor } from '../app/route.ts';
import type { DocChange } from '../app/types.ts';
import { lineOfAnchor } from './file-lines.ts';
import { FileView } from './FileView.tsx';
import { frameOrigin, rawHref } from './frame.ts';
import { HtmlFrame } from './HtmlFrame.tsx';
import { CopyPathButton } from './MetaPanel.tsx';
import { ProjectViewerPane } from './ProjectViewerPane.tsx';

type Common = {
  path: string;
  src: Source;
  agent: boolean;
  /** 주소의 앵커. `L12` 같은 줄 앵커면 원문으로 연다(스펙의 줄을 가리킨 링크다). `/…` 는 셸 라우트다. */
  anchor: string;
  gitRawPort?: number | null;
  /** /api/info 의 주 포트. 개인 이름 뒤에서만 쓴다(frameOrigin). */
  rawPort?: number | null;
  /** git 소스 html(개인 이름 뒤면 모든 html)은 /api/info 의 포트를 안 뒤에 연다(App 과 같은 규칙). 되돌린 틀에서만 쓴다. */
  infoReady: boolean;
  /** 볼트 문서 열기(앱 안 이동). 셸의 근거·원본 링크도 이것으로 간다. */
  onNavigate: (path: string, anchor?: string) => void;
  onChange?: (change: DocChange | null) => void;
};

/** 통합 보기 데이터의 상태. */
export type ProjectViewerState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'data'; data: ProjectViewerResponse };

type BodyProps = Common & {
  /** 받은 산출물 정보. 못 받았으면(오류) null — 산출물 링크·되돌림 틀이 없다. */
  spec: ViewerSpecResponse | null;
  /** 통합 보기 데이터. 에이전트 모드는 쓰지 않는다. */
  pv: ProjectViewerState;
  mode: ViewerSpecMode;
  onMode: (mode: ViewerSpecMode) => void;
};

/** 산출물을 프로젝트 폴더 기준으로 줄인다(`projects/devops/outputs/viewer/index.html` → `outputs/viewer/index.html`). */
function underProject(project: string | null, p: string): string {
  return project !== null && p.startsWith(`${project}/`) ? p.slice(project.length + 1) : p;
}

/** 막대에 보일 스펙 이름(`config/viewer.yml` → `viewer.yml`). 프로젝트 밖이면 파일 이름. */
function specLabel(spec: ViewerSpecResponse | null, path: string): string {
  if (spec?.project != null) return underProject(spec.project, path).replace(/^config\//, '');
  return path.split('/').pop() ?? path;
}

/** 검사 오류 목록. 오류를 먼저, 경고를 뒤에 둔다. */
function IssueList({ issues }: { issues: Issue[] }) {
  const sorted = [...issues.filter((i) => i.level === 'error'), ...issues.filter((i) => i.level !== 'error')];
  const errors = issues.filter((i) => i.level === 'error').length;
  return (
    <section className="viewer-spec-issues" role="status">
      <p className="notice">
        viewer.yml 검사에서 오류 {errors}건이 나와 화면을 그리지 않았다. 원문을 고친 뒤 다시 연다.
      </p>
      <ul>
        {sorted.map((i, n) => (
          <li key={n} data-level={i.level}>
            <code>{i.code}</code> <span className="viewer-spec-issue-where">{i.where || '(문서 전체)'}</span> — {i.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 응답 둘(산출물 정보·통합 보기 데이터)과 토글 상태를 그린다(요청 없음). SSR 시험이 이것을 그린다. */
export function ViewerSpecBody(props: BodyProps) {
  const { path, src, agent, anchor, gitRawPort, rawPort, infoReady, onNavigate, onChange, spec, pv, mode, onMode } = props;
  const text = <FileView path={path} src={src} agent={agent} anchor={anchor} gitRawPort={gitRawPort} rawPort={rawPort} onChange={onChange} />;
  const output = spec !== null && spec.exists ? spec.output : null;

  if (agent) {
    // 에이전트 모드: 예전 그대로 텍스트다. 산출물 원본 주소를 알리고 원문을 보인다.
    if (spec === null) return text;
    const origin = typeof location === 'undefined' ? '' : frameOrigin(location.hostname, location.port, src, gitRawPort, rawPort);
    return (
      <>
        {output !== null ? (
          <p data-viewer-output={output} data-stale={spec.stale === true ? '1' : undefined}>
            렌더 화면: <a href={rawHref(origin, output, '', src)}>{output}</a>
            {spec.stale === true ? ' — 빌드가 viewer.yml 보다 오래됐다' : null}
          </p>
        ) : (
          <p data-viewer-output="">{missingNote(spec)}</p>
        )}
        {text}
      </>
    );
  }

  const link = (target: string, label: string): ReactNode => (
    <a
      href={hrefFor(target, undefined, agent, src)}
      title={target}
      onClick={(e) => {
        if (!isPlainClick(e)) return;
        e.preventDefault();
        onNavigate(target);
      }}
    >
      {label}
    </a>
  );
  const shown: ViewerSpecMode = lineOfAnchor(anchor) !== null ? 'raw' : mode;
  const origin = typeof location === 'undefined' ? '' : frameOrigin(location.hostname, location.port, src, gitRawPort, rawPort);
  const bar = (
    <div className="html-frame-bar viewer-spec-bar">
      <span className="viewer-spec-route">
        {link(path, specLabel(spec, path))}
        {output !== null ? (
          <>
            <span aria-hidden="true"> → </span>
            {link(output, underProject(spec?.project ?? null, output))}
          </>
        ) : null}
      </span>
      <span className="viewer-spec-toggle" role="group" aria-label="보기">
        <button type="button" aria-pressed={shown === 'rendered'} onClick={() => onMode('rendered')}>
          렌더 보기
        </button>
        <button type="button" aria-pressed={shown === 'raw'} onClick={() => onMode('raw')}>
          원문 보기
        </button>
      </span>
      {output !== null ? (
        <a className="html-frame-open" href={rawHref(origin, output, '', src)} target="_blank" rel="noreferrer" title="빌드 산출물(단일 HTML)을 새 탭에서 연다">
          산출물 새 탭
        </a>
      ) : null}
      <CopyPathButton path={path} />
    </div>
  );

  const textBox = (note?: ReactNode) => (
    <div className="viewer-spec-text">
      {note}
      {text}
    </div>
  );

  let body: ReactNode;
  if (shown === 'raw') {
    body = textBox();
  } else if (pv.kind === 'loading') {
    body = <p className="notice viewer-spec-text">불러오는 중…</p>;
  } else if (pv.kind === 'error') {
    // 셸을 못 불러왔다: 산출물이 있으면 기존 html 틀로 되돌리고(최후 수단), 없으면 원문에 까닭을 단다.
    const why = `통합 보기를 그리지 못했다 — ${pv.message}`;
    if (output !== null && (src.kind === 'local' || infoReady)) {
      body = (
        <HtmlFrame
          path={output}
          hash=""
          src={src}
          gitRawPort={gitRawPort}
          rawPort={rawPort}
          bar={() => <span className="viewer-spec-route viewer-spec-fallback">{why}. 빌드 산출물을 보인다.</span>}
        />
      );
    } else {
      body = textBox(
        <p className="notice viewer-spec-note" role="status">
          {why}
        </p>,
      );
    }
  } else if (!pv.data.ok) {
    body = textBox(<IssueList issues={pv.data.issues} />);
  } else {
    body = <ProjectViewerPane spec={path} bundle={pv.data.bundle} agent={agent} src={src} onNavigate={onNavigate} />;
  }

  return (
    <div className="viewer-spec">
      {bar}
      {body}
    </div>
  );
}

/** 프로젝트 뷰어 산출물(html)을 볼 때 막대에 다는 링크 — 그 viewer.yml 의 통합 보기로 간다. 산출물이 아니면 그리지 않는다. */
export function IntegratedViewLink({ output, agent, src, onNavigate }: { output: string; agent: boolean; src: Source; onNavigate: (path: string) => void }) {
  const spec = viewerSpecOfOutput(output);
  if (spec === null) return null;
  return (
    <a
      className="html-frame-integrated"
      href={hrefFor(spec, undefined, agent, src)}
      title={`${spec} — iframe 없이 이 화면 안에서 연다`}
      onClick={(e) => {
        if (!isPlainClick(e)) return;
        e.preventDefault();
        onNavigate(spec);
      }}
    >
      통합 보기로 열기
    </a>
  );
}

function missingNote(spec: ViewerSpecResponse): string {
  if (spec.project === null) {
    return '빌드 대상 위치가 아니다 — project-viewer cli 는 <프로젝트>/config/viewer.yml 만 빌드한다. 원문을 보인다.';
  }
  return `빌드 산출물이 없다 — project-viewer-build 로 빌드한다(${viewerBuildCommand(spec.project)})`;
}

/** 산출물 정보와 통합 보기 데이터를 받아 ViewerSpecBody 를 그린다. 토글은 세션 동안만 기억한다(기본 렌더 보기). */
export function ViewerSpecView(props: Common) {
  const { path, src, agent } = props;
  // 받은 것은 요청 키(소스·경로)와 함께 둔다 — 주소가 바뀐 뒤 새 응답이 오기 전에 옛 화면을 그리지 않게.
  const key = `${sourceKey(src)}\0${path}`;
  const [got, setGot] = useState<{ key: string; spec: ViewerSpecResponse | null } | null>(null);
  const [pv, setPv] = useState<{ key: string; state: ProjectViewerState } | null>(null);
  const [mode, setMode] = useState<ViewerSpecMode>(readViewerSpecMode);

  useEffect(() => {
    let live = true;
    getViewerSpec(path, src).then(
      (s) => live && setGot({ key, spec: s }),
      // 못 받으면 산출물 링크만 없다.
      () => live && setGot({ key, spec: null }),
    );
    // 에이전트 모드는 통합 보기를 그리지 않는다.
    if (!agent) {
      getProjectViewer(path, src).then(
        (data) => live && setPv({ key, state: { kind: 'data', data } }),
        (e: unknown) => live && setPv({ key, state: { kind: 'error', message: e instanceof Error ? e.message : String(e) } }),
      );
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, agent]);

  const specNow = got !== null && got.key === key ? got.spec : null;
  // 에이전트 모드는 산출물 정보를 기다린다. 통합 보기는 기다리지 않는다 — 산출물 링크는 오면 붙는다.
  if (agent && specNow === null && (got === null || got.key !== key)) return <p className="notice">불러오는 중…</p>;
  const onMode = (m: ViewerSpecMode) => {
    setMode(m);
    writeViewerSpecMode(m);
  };
  const state: ProjectViewerState = pv !== null && pv.key === key ? pv.state : { kind: 'loading' };
  return <ViewerSpecBody {...props} spec={specNow} pv={state} mode={mode} onMode={onMode} />;
}
