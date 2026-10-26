// 기본 테마. tokens.css 의 색을 옮겨 적어 리더와 같은 팔레트로 그린다.
// 결정: 노드는 surface 계열 채움 + accent 2px 테두리·둥근 모서리, 선은 text-2 2px, 노드 라벨 600 굵기,
// 엣지 라벨은 한 단계 작은 글씨에 배경 칩, 상태도의 시작·끝 표식은 accent-strong, 시퀀스 노트는 amber 톤.
import type { MermaidTheme, ScreenPalette } from './types.ts';

type Palette = ScreenPalette;

// tokens.css :root 와 같은 값. 바꿀 때는 둘을 같이 바꾼다.
const LIGHT: Palette = {
  bg: '#f7f8fa',
  surface: '#ffffff',
  surface2: '#eef1f5',
  surface3: '#e3e8ef',
  line: '#d6dce5',
  lineStrong: '#b9c2ce',
  text: '#1a2430',
  text2: '#4d5a68',
  text3: '#71808f',
  accent: '#0f6b6b',
  accentStrong: '#0a5252',
  accentSoft: '#e2efee',
  amberBg: '#faeed7',
  amberFg: '#86571a',
  amberLine: '#e6cfa4',
  redBg: '#f7dfdf',
  redFg: '#8c2b2b',
};

// tokens.css 다크 블록과 같은 값.
const DARK: Palette = {
  bg: '#12171d',
  surface: '#182029',
  surface2: '#1f2832',
  surface3: '#2a3540',
  line: '#2f3a46',
  lineStrong: '#46535f',
  text: '#e4eaf0',
  text2: '#aab6c2',
  text3: '#83919f',
  accent: '#57bdb5',
  accentStrong: '#7fd3cb',
  accentSoft: '#1b2f30',
  amberBg: '#392d18',
  amberFg: '#dcb473',
  amberLine: '#574328',
  redBg: '#3a2122',
  redFg: '#e79d9d',
};

// tokens.css --font 와 같다. 외부 글꼴을 받지 않는다.
export const VAULT_FONT =
  "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Pretendard', 'Noto Sans KR', 'Segoe UI', sans-serif";

// svg 안 <style> 에 붙는 규칙. 선 굵기·모서리·글자 굵기는 themeVariables 로는 못 정한다.
const THEME_CSS = `
  .node rect, .node polygon, .node circle, .node ellipse, .node path, .node .label-container,
  .cluster rect, .actor, .statediagram-state rect, .statediagram-cluster rect { stroke-width: 2px; }
  .node rect, .node .label-container, .cluster rect, .statediagram-cluster rect { rx: 8px; ry: 8px; }
  .edgePath .path, .flowchart-link, .transition, .messageLine0, .messageLine1, .loopLine { stroke-width: 2px; }
  .actor-line { stroke-width: 1.5px; stroke-dasharray: 4 4; }
  .nodeLabel, .stateLabel, .statediagram-state .label, text.actor, .actor > tspan, .cluster-label .nodeLabel,
  .cluster-label text, .statediagram-cluster .cluster-label text { font-weight: 600; }
  .edgeLabel, .edgeLabel p, .edgeLabel .label, .transition-label text, .messageText, .loopText, .loopText > tspan { font-size: 13px; font-weight: 500; }
  /* 칩 여백은 블록(p)에만 둔다 — 인라인 span 에 두면 빈 줄 상자가 생겨 라벨이 세로로 늘어난다. */
  .edgeLabel p { padding: 1px 6px; border-radius: 4px; }
  .edgeLabel rect, .stateLabel rect, .transition-label rect { rx: 4px; ry: 4px; }
  .messageText { font-weight: 500; }
  .noteText, .noteText > tspan { font-size: 13px; }
`;

export const vault: MermaidTheme = {
  id: 'vault',
  title: '볼트',
  description: '리더와 같은 색·글꼴. 둥근 노드, 2px 선, 굵은 라벨. 라이트·다크 모두. 화면 테마를 바꾸면 그 색을 따른다.',
  init: (dark, screen) => {
    // 화면 테마가 기본이 아니면 그 테마의 토큰 값으로 그린다. 기본이면 아래 내장 값(tokens.css 와 같다).
    const p = screen ?? (dark ? DARK : LIGHT);
    const nodeFill = dark ? p.surface2 : p.surface;
    const clusterFill = dark ? p.surface : p.surface2;
    const clusterLine = p.lineStrong;
    const chip = dark ? p.surface3 : p.surface;
    return {
      theme: 'base',
      fontFamily: VAULT_FONT,
      themeVariables: {
        darkMode: dark,
        background: p.bg,
        fontFamily: VAULT_FONT,
        fontSize: '14px',

        // 노드
        primaryColor: nodeFill,
        primaryTextColor: p.text,
        primaryBorderColor: p.accent,
        secondaryColor: p.accentSoft,
        secondaryTextColor: p.text,
        secondaryBorderColor: p.accent,
        tertiaryColor: p.surface3,
        tertiaryTextColor: p.text,
        tertiaryBorderColor: clusterLine,
        mainBkg: nodeFill,
        nodeBkg: nodeFill,
        nodeBorder: p.accent,
        nodeTextColor: p.text,
        textColor: p.text,
        titleColor: p.text,

        // 선·화살표·엣지 라벨
        lineColor: p.text2,
        defaultLinkColor: p.text2,
        arrowheadColor: p.text2,
        edgeLabelBackground: chip,
        labelBackground: chip,
        labelBackgroundColor: chip,
        labelColor: p.text2,
        labelTextColor: p.text2,

        // 서브그래프
        clusterBkg: clusterFill,
        clusterBorder: clusterLine,

        // 상태도
        stateBkg: nodeFill,
        stateBorder: p.accent,
        stateLabelColor: p.text,
        transitionColor: p.text2,
        transitionLabelColor: p.text2,
        stateEdgeLabelBackground: chip,
        specialStateColor: p.accentStrong,
        compositeBackground: clusterFill,
        compositeBorder: clusterLine,
        compositeTitleBackground: p.surface3,
        innerEndBackground: nodeFill,

        // 시퀀스
        actorBkg: nodeFill,
        actorBorder: p.accent,
        actorTextColor: p.text,
        actorLineColor: p.lineStrong,
        signalColor: p.text2,
        signalTextColor: p.text,
        labelBoxBkgColor: clusterFill,
        labelBoxBorderColor: clusterLine,
        loopTextColor: p.text2,
        noteBkgColor: p.amberBg,
        noteBorderColor: p.amberLine,
        noteTextColor: p.amberFg,
        activationBkgColor: p.accentSoft,
        activationBorderColor: p.accent,
        sequenceNumberColor: dark ? p.bg : p.surface,

        errorBkgColor: p.redBg,
        errorTextColor: p.redFg,
      },
      themeCSS: THEME_CSS,
      flowchart: { curve: 'basis', padding: 12, nodeSpacing: 40, rankSpacing: 48, htmlLabels: true },
      state: { padding: 10, nodeSpacing: 40, rankSpacing: 48 },
      sequence: { actorMargin: 40, messageMargin: 36, boxMargin: 8, noteMargin: 8, mirrorActors: false, actorFontWeight: 600 },
    };
  },
};
