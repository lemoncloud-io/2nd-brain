// 흑백 인쇄용·고대비. 화면 테마와 상관없이 늘 흰 바탕에 검은 2px 선이다 — 그릇을 흰 카드로 만들어 다크 화면에서도 같게 보인다.
import type { MermaidTheme } from './types.ts';
import { VAULT_FONT } from './vault.ts';

const INK = '#000000';
const PAPER = '#ffffff';
const GREY = '#e8e8e8';

const THEME_CSS = `
  .node rect, .node polygon, .node circle, .node ellipse, .node path, .node .label-container,
  .cluster rect, .actor, .statediagram-state rect, .statediagram-cluster rect { stroke-width: 2px; }
  .edgePath .path, .flowchart-link, .transition, .messageLine0, .messageLine1, .loopLine, .actor-line { stroke-width: 2px; }
  .nodeLabel, .stateLabel, text.actor, .actor > tspan, .cluster-label text { font-weight: 700; }
  .edgeLabel, .edgeLabel p, .messageText, .transition-label text { font-size: 13px; font-weight: 600; }
`;

export const mono: MermaidTheme = {
  id: 'mono',
  title: '흑백',
  description: '인쇄용 고대비. 흰 바탕, 검은 2px 선. 다크 화면에서도 흰 카드로 보인다.',
  init: () => ({
    theme: 'base',
    fontFamily: VAULT_FONT,
    themeVariables: {
      darkMode: false,
      background: PAPER,
      fontFamily: VAULT_FONT,
      fontSize: '14px',
      primaryColor: PAPER,
      primaryTextColor: INK,
      primaryBorderColor: INK,
      secondaryColor: GREY,
      secondaryTextColor: INK,
      secondaryBorderColor: INK,
      tertiaryColor: PAPER,
      tertiaryTextColor: INK,
      tertiaryBorderColor: INK,
      mainBkg: PAPER,
      nodeBkg: PAPER,
      nodeBorder: INK,
      nodeTextColor: INK,
      textColor: INK,
      titleColor: INK,
      lineColor: INK,
      defaultLinkColor: INK,
      arrowheadColor: INK,
      edgeLabelBackground: PAPER,
      labelBackground: PAPER,
      labelBackgroundColor: PAPER,
      labelColor: INK,
      labelTextColor: INK,
      clusterBkg: PAPER,
      clusterBorder: INK,
      stateBkg: PAPER,
      stateBorder: INK,
      stateLabelColor: INK,
      transitionColor: INK,
      transitionLabelColor: INK,
      stateEdgeLabelBackground: PAPER,
      specialStateColor: INK,
      compositeBackground: PAPER,
      compositeBorder: INK,
      compositeTitleBackground: GREY,
      innerEndBackground: PAPER,
      actorBkg: PAPER,
      actorBorder: INK,
      actorTextColor: INK,
      actorLineColor: INK,
      signalColor: INK,
      signalTextColor: INK,
      labelBoxBkgColor: PAPER,
      labelBoxBorderColor: INK,
      loopTextColor: INK,
      noteBkgColor: GREY,
      noteBorderColor: INK,
      noteTextColor: INK,
      activationBkgColor: GREY,
      activationBorderColor: INK,
      sequenceNumberColor: PAPER,
      errorBkgColor: GREY,
      errorTextColor: INK,
    },
    themeCSS: THEME_CSS,
    flowchart: { curve: 'linear', padding: 12, nodeSpacing: 40, rankSpacing: 48, htmlLabels: true },
    state: { padding: 10, nodeSpacing: 40, rankSpacing: 48 },
    sequence: { actorMargin: 40, messageMargin: 36, mirrorActors: false, actorFontWeight: 700 },
  }),
  // 그린 그림만 흰 카드다 — 대기·오류 그릇은 리더 색 그대로.
  css: `
    .mermaid[data-mermaid-theme="mono"]:not(.mermaid-pending):not(.mermaid-error) { background: #ffffff; padding: 8px; border-radius: var(--radius); }
    .mermaid[data-mermaid-theme="mono"] svg { display: block; margin: 0 auto; }
  `,
};
