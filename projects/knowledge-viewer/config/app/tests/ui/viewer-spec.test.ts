// viewer.yml 보기: 스펙 → 산출물 경로(순수), 토글 기억(sessionStorage), SSR 로 그린 통합 보기·원문 보기·오류 목록·되돌림 틀.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../helpers/tsx-hooks.ts';
import { isViewerSpecPath, viewerBuildCommand, viewerOutputOf, viewerProjectOf, viewerSpecOfOutput } from '../../shared/viewer-spec.ts';
import type { ViewerSpecResponse } from '../../shared/viewer-spec.ts';
import type { Bundle } from '../../shared/project-viewer.ts';
import type { Source } from '../../shared/source.ts';
import { readViewerSpecMode, writeViewerSpecMode } from '../../src/app/prefs.ts';

const { IntegratedViewLink, ViewerSpecBody } = await import('../../src/reader/ViewerSpecView.tsx');
const { HtmlFrame } = await import('../../src/reader/HtmlFrame.tsx');
type PvState = import('../../src/reader/ViewerSpecView.tsx').ProjectViewerState;

const LOCAL: Source = { kind: 'local' };

test('isViewerSpecPath: 이름이 정확히 viewer.yml 인 파일만', () => {
  assert.equal(isViewerSpecPath('projects/devops/config/viewer.yml'), true);
  assert.equal(isViewerSpecPath('projects/x/outputs/paper/viewer.yml'), true);
  assert.equal(isViewerSpecPath('viewer.yml'), true);
  assert.equal(isViewerSpecPath('projects/x/config/my-viewer.yml'), false);
  assert.equal(isViewerSpecPath('projects/x/config/viewer.yaml'), false);
  assert.equal(isViewerSpecPath('projects/x/config/viewer.yml.md'), false);
});

test('viewerOutputOf: <p>/config/viewer.yml → <p>/outputs/viewer/index.html, config 밖·다른 파일은 null', () => {
  assert.equal(viewerOutputOf('projects/devops/config/viewer.yml'), 'projects/devops/outputs/viewer/index.html');
  assert.equal(viewerProjectOf('projects/devops/config/viewer.yml'), 'projects/devops');
  assert.equal(viewerOutputOf('projects/a/b/config/viewer.yml'), 'projects/a/b/outputs/viewer/index.html');
  assert.equal(viewerOutputOf('projects/project-viewer/outputs/paper-migration/explainer/viewer.yml'), null);
  assert.equal(viewerOutputOf('config/viewer.yml'), null);
  assert.equal(viewerOutputOf('viewer.yml'), null);
  assert.equal(viewerOutputOf('projects/devops/config/README.md'), null);
  assert.equal(viewerBuildCommand('projects/devops'), 'node projects/project-viewer/config/shell/cli.ts build projects/devops');
});

test('viewerSpecOfOutput: 산출물 → 스펙(viewerOutputOf 의 반대), 다른 html 은 null', () => {
  assert.equal(viewerSpecOfOutput('projects/devops/outputs/viewer/index.html'), 'projects/devops/config/viewer.yml');
  assert.equal(viewerOutputOf(viewerSpecOfOutput('projects/a/b/outputs/viewer/index.html')!), 'projects/a/b/outputs/viewer/index.html');
  assert.equal(viewerSpecOfOutput('projects/devops/outputs/site/index.html'), null);
  assert.equal(viewerSpecOfOutput('outputs/viewer/index.html'), null);
  assert.equal(viewerSpecOfOutput('projects/devops/outputs/viewer/index.htm'), null);
});

function withSession<T>(store: Map<string, string> | 'throw', fn: () => T): T {
  const g = globalThis as { sessionStorage?: unknown };
  const prev = g.sessionStorage;
  const boom = () => {
    throw new Error('blocked');
  };
  g.sessionStorage =
    store === 'throw'
      ? { getItem: boom, setItem: boom }
      : { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  try {
    return fn();
  } finally {
    g.sessionStorage = prev;
  }
}

test('토글 기억: 기본 렌더, 원문을 고르면 세션 동안 원문, 저장소가 던져도 기본', () => {
  const store = new Map<string, string>();
  withSession(store, () => {
    assert.equal(readViewerSpecMode(), 'rendered');
    writeViewerSpecMode('raw');
    assert.equal(readViewerSpecMode(), 'raw');
    writeViewerSpecMode('rendered');
    assert.equal(readViewerSpecMode(), 'rendered');
  });
  withSession('throw', () => {
    assert.equal(readViewerSpecMode(), 'rendered');
    writeViewerSpecMode('raw'); // 던지지 않는다
  });
  // sessionStorage 가 아예 없어도(SSR) 기본이다.
  assert.equal(readViewerSpecMode(), 'rendered');
});

const SPEC = 'projects/devops/config/viewer.yml';
const OUT = 'projects/devops/outputs/viewer/index.html';

function resp(over: Partial<ViewerSpecResponse> = {}): ViewerSpecResponse {
  return {
    spec: SPEC,
    project: 'projects/devops',
    output: OUT,
    exists: true,
    stale: false,
    basis: 'commit',
    specTime: 1_000,
    outputTime: 2_000,
    ...over,
  };
}

// 통합 보기 데이터. 셸 화면은 lazy 로 불러오므로 SSR 에서는 불러오는 중 자리만 그린다(셸 화면 자체는 project-viewer-embed 시험).
const BUNDLE = { viewer: { meta: { title: 'devops' } } } as unknown as Bundle;
const DATA: PvState = { kind: 'data', data: { ok: true, spec: SPEC, bundle: BUNDLE } };

function render(
  spec: ViewerSpecResponse | null,
  over: { pv?: PvState; mode?: 'rendered' | 'raw'; agent?: boolean; anchor?: string; src?: Source; infoReady?: boolean } = {},
) {
  const g = globalThis as { location?: unknown };
  const prev = g.location;
  g.location = { hostname: '127.0.0.1', port: '8796' };
  try {
    return renderToStaticMarkup(
      createElement(ViewerSpecBody, {
        path: spec?.spec ?? SPEC,
        src: over.src ?? LOCAL,
        agent: over.agent ?? false,
        anchor: over.anchor ?? '',
        gitRawPort: 8797,
        infoReady: over.infoReady ?? true,
        onNavigate: () => {},
        spec,
        pv: over.pv ?? DATA,
        mode: over.mode ?? 'rendered',
        onMode: () => {},
      }),
    );
  } finally {
    g.location = prev;
  }
}

test('렌더 보기 = 통합 보기: iframe 없이 스크롤 칸에 셸 화면, 막대는 스펙 → 산출물·토글·산출물 새 탭', () => {
  const html = render(resp());
  assert.doesNotMatch(html, /<iframe/);
  assert.match(html, /class="viewer-spec-inline"/);
  assert.match(html, /셸 화면을 불러오는 중/);
  assert.match(html, /href="\/v\/projects\/devops\/config\/viewer\.yml\?src=local"[^>]*>viewer\.yml<\/a>/);
  assert.match(html, /href="\/v\/projects\/devops\/outputs\/viewer\/index\.html\?src=local"[^>]*>outputs\/viewer\/index\.html<\/a>/);
  assert.match(html, /<button type="button" aria-pressed="true">렌더 보기<\/button>/);
  assert.match(html, /<button type="button" aria-pressed="false">원문 보기<\/button>/);
  assert.match(html, /href="http:\/\/localhost:8796\/raw\/projects\/devops\/outputs\/viewer\/index\.html"[^>]*>산출물 새 탭</);
  // 산출물이 낡았다는 알림은 이제 없다(통합 보기는 빌드를 거치지 않는다).
  assert.doesNotMatch(render(resp({ stale: true })), /오래됐다/);
});

test('산출물이 없거나 빌드 대상 위치가 아니어도 통합 보기를 그린다(산출물 링크만 없다)', () => {
  const none = render(resp({ exists: false, stale: null, basis: null, specTime: null, outputTime: null }));
  assert.match(none, /class="viewer-spec-inline"/);
  assert.doesNotMatch(none, /outputs\/viewer\/index\.html|산출물 새 탭|빌드 산출물이 없다/);
  const other = 'projects/project-viewer/outputs/paper-migration/explainer/viewer.yml';
  const bare = render(resp({ spec: other, project: null, output: null, exists: false, stale: null }));
  assert.match(bare, /class="viewer-spec-inline"/);
  assert.match(bare, />viewer\.yml<\/a>/);
  // 산출물 정보를 못 받아도 그린다.
  assert.match(render(null), /class="viewer-spec-inline"/);
});

test('원문 보기 토글·줄 앵커는 텍스트 파일 보기, 셸 라우트 앵커(#/…)는 통합 보기', () => {
  const raw = render(resp(), { mode: 'raw' });
  assert.doesNotMatch(raw, /viewer-spec-inline|<iframe/);
  assert.match(raw, /<button type="button" aria-pressed="true">원문 보기<\/button>/);
  assert.match(raw, /viewer-spec-text/);
  assert.match(raw, /불러오는 중/); // FileView 는 SSR 에서 받기 전 상태다
  assert.doesNotMatch(render(resp(), { anchor: 'L12' }), /viewer-spec-inline/);
  assert.match(render(resp(), { anchor: '/p/P-arch/N-intake' }), /viewer-spec-inline/);
});

test('검사 오류면 오류 목록(오류 먼저)과 원문', () => {
  const pv: PvState = {
    kind: 'data',
    data: {
      ok: false,
      spec: SPEC,
      issues: [
        { level: 'warning', code: 'W_INHERITED', message: '물려받음', where: 'pages[0]' },
        { level: 'error', code: 'E_REF_UNRESOLVED', message: '그런 헤딩이 없다: X', where: 'glossary[1].evidence[0]' },
      ],
    },
  };
  const html = render(resp(), { pv });
  assert.doesNotMatch(html, /viewer-spec-inline|<iframe/);
  assert.match(html, /viewer\.yml 검사에서 오류 1건이 나와 화면을 그리지 않았다/);
  assert.ok(html.indexOf('E_REF_UNRESOLVED') < html.indexOf('W_INHERITED'));
  assert.match(html, /glossary\[1\]\.evidence\[0\]/);
  assert.match(html, /viewer-spec-text/);
});

test('셸을 못 불러오면: 산출물이 있으면 기존 html 틀(같은 sandbox)로 되돌리고, 없으면 원문에 까닭', () => {
  const pv: PvState = { kind: 'error', message: 'project-viewer 셸을 불러오지 못했다' };
  const html = render(resp(), { pv });
  assert.match(html, /<iframe[^>]*src="http:\/\/localhost:8796\/raw\/projects\/devops\/outputs\/viewer\/index\.html"/);
  assert.match(html, /sandbox="allow-scripts allow-same-origin allow-popups"/);
  assert.match(html, /통합 보기를 그리지 못했다 — project-viewer 셸을 불러오지 못했다\. 빌드 산출물을 보인다/);
  // git 소스는 /api/info 를 받기 전에는 틀을 열지 않는다.
  const pr: Source = { kind: 'pr', number: 12 };
  assert.match(render(resp(), { pv, src: pr }), /src="http:\/\/localhost:8797\/raw\/@pr\/12\/projects\/devops\/outputs\/viewer\/index\.html"/);
  assert.doesNotMatch(render(resp(), { pv, src: pr, infoReady: false }), /<iframe/);
  const none = render(resp({ exists: false }), { pv });
  assert.doesNotMatch(none, /<iframe/);
  assert.match(none, /통합 보기를 그리지 못했다/);
  assert.match(render(resp(), { pv: { kind: 'loading' } }), /불러오는 중/);
});

test('에이전트 모드는 예전 그대로: 틀·통합 보기 없이 산출물 주소와 원문', () => {
  const agent = render(resp({ stale: true }), { agent: true });
  assert.doesNotMatch(agent, /<iframe|<button|viewer-spec-inline/);
  assert.match(agent, /data-viewer-output="projects\/devops\/outputs\/viewer\/index\.html"/);
  assert.match(agent, /href="http:\/\/localhost:8796\/raw\/projects\/devops\/outputs\/viewer\/index\.html"/);
  assert.match(agent, /빌드가 viewer\.yml 보다 오래됐다/);
  const missing = render(resp({ exists: false, stale: null, basis: null, specTime: null, outputTime: null }), { agent: true });
  assert.match(missing, /빌드 산출물이 없다 — project-viewer-build 로 빌드한다\(node projects\/project-viewer\/config\/shell\/cli\.ts build projects\/devops\)/);
  // 산출물 정보를 못 받으면 원문만.
  assert.match(render(null, { agent: true }), /불러오는 중/);
});

test('프로젝트 뷰어 산출물(html)의 막대: "통합 보기로 열기" → 그 viewer.yml(같은 소스), 다른 html 은 없음', () => {
  const g = globalThis as { location?: unknown };
  const prev = g.location;
  g.location = { hostname: '127.0.0.1', port: '8796' };
  try {
    const frame = (path: string, src: Source) =>
      renderToStaticMarkup(
        createElement(HtmlFrame, {
          path,
          hash: '',
          src,
          extra: createElement(IntegratedViewLink, { output: path, agent: false, src, onNavigate: () => {} }),
        }),
      );
    const html = frame(OUT, { kind: 'pr', number: 3 });
    assert.match(html, /<a class="html-frame-integrated" href="\/v\/projects\/devops\/config\/viewer\.yml\?src=pr:3"[^>]*>통합 보기로 열기<\/a>/);
    // html 보기 자체(틀·sandbox)는 그대로다.
    assert.match(html, /sandbox="allow-scripts allow-same-origin allow-popups"/);
    assert.doesNotMatch(frame('projects/devops/outputs/site/index.html', LOCAL), /통합 보기로 열기/);
  } finally {
    g.location = prev;
  }
});

test('HtmlFrame: 개인 이름 뒤면 틀·새 탭 주소가 같은 호스트 /raw — localhost 출처가 없다', () => {
  // 개인 이름 화면을 흉내 낸다. 이 틀은 안쪽 DOM 을 읽지 않으므로 불투명 출처에서도 그대로 그린다.
  const g = globalThis as { location?: unknown };
  const prev = g.location;
  g.location = { hostname: 'vault.test', port: '' };
  try {
    const local = renderToStaticMarkup(createElement(HtmlFrame, { path: 'outputs/a.html', hash: '#x', src: LOCAL, gitRawPort: 8797, rawPort: 8796 }));
    assert.match(local, /<iframe[^>]*src="\/raw\/outputs\/a\.html#x"/);
    assert.match(local, /href="\/raw\/outputs\/a\.html#x"/);
    assert.doesNotMatch(local, /localhost/);
    const main = renderToStaticMarkup(createElement(HtmlFrame, { path: 'outputs/a.html', hash: '', src: { kind: 'main' }, gitRawPort: 8797, rawPort: 8796 }));
    assert.match(main, /<iframe[^>]*src="\/raw\/@main\/outputs\/a\.html"/);
    assert.doesNotMatch(main, /localhost/);
  } finally {
    g.location = prev;
  }
});
