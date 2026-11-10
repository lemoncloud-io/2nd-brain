// archify html 틀 맞춤 주입. `/raw/…html?kv-fit=1` 일 때만 <head> 맨 앞에 작은 style·script 를 넣는다.
// 다른 html(HtmlFrame 경로)은 이 쿼리를 붙이지 않으므로 바이트 그대로다. 원본 파일은 고치지 않는다.
import {
  ARCHIFY_FRAME_MAX_HEIGHT,
  ARCHIFY_ZOOM_STEPS,
  FIT_HEIGHT,
  FIT_READY,
  FIT_SETTINGS,
  wantsArchifyFit,
} from '../shared/archify-fit.ts';

/**
 * 맞춤 모드에서 archify 스크립트가 읽는 창 높이(px). iframe 높이를 내용에 맞추면 archify 의 "첫 화면에 맞추기"
 * (innerHeight 로 그림 폭을 정하고 넘치면 줄이는 reader layout)가 틀 높이와 고리를 이룬다 — 높이가 바뀔 때마다 폭이 다시 정해진다.
 * 창 높이를 틀과 무관한 큰 고정값으로 보이게 하면 그림은 폭 기준(열 폭)으로 한 번 정해지고 고리가 끊긴다.
 */
export const FIT_VIEWPORT_HEIGHT = 100000;

/** 주입 style: 뷰포트 높이에 묶인 규칙을 풀고, 배율이 있으면 그림을 통째로 키운다(넘치면 그림 칸 안에서 가로로 민다). */
const FIT_STYLE = [
  // 뷰포트 높이(100vh)를 최소로 잡는 body 는 틀을 줄이지 못하게 막는다 — 내용 높이만 잰다.
  'html[data-kv-fit] body{min-height:0!important}',
  // 부모와 연결되면 안쪽 세로 스크롤바를 없앤다(틀 높이 = 내용 높이).
  'html[data-kv-fit-linked]{overflow-y:hidden!important}',
  // 큰 창 높이 때문에 reader area 의 최소 높이가 커지지 않게 한다.
  'html[data-kv-fit][data-reader-area="true"] .diagram-container{min-height:0!important}',
  // 그림 배율: SVG 폭(과 그 비율로 높이)을 배율만큼 키운다. 글자와 상자가 함께 커져 넘치지 않는다.
  'html[data-kv-zoom] .diagram-container{overflow-x:auto!important;overflow-y:hidden!important}',
  'html[data-kv-zoom] .diagram-container>svg{width:calc(100% * var(--kv-zoom))!important;min-width:calc(min(900px,100%) * var(--kv-zoom))!important;max-width:calc(var(--archify-diagram-max-width,100000px) * var(--kv-zoom))!important}',
  '@media (max-width:720px){html[data-kv-zoom] .diagram-container[data-wide-diagram="true"]>svg{min-width:calc(720px * var(--kv-zoom))!important}}',
  // 가로로 밀어도 그림 위 도구(확대·찾기 등)는 제자리에 둔다 — archify 가 스크롤마다 --archify-scroll-x 를 적는다.
  'html[data-kv-zoom] .diagram-container>:is(.diagram-nav,.overview-map,.focus-chip,.route-probe,.semantic-lens,.diagram-guide,.node-finder){transform:translateX(var(--archify-scroll-x,0px))}',
].join('\n');

/** 주입 script(ES5). 높이를 재 부모에 알리고, 부모가 보낸 배율을 적용한다. */
const FIT_SCRIPT = `(function () {
  'use strict';
  var html = document.documentElement;
  var parentWin = window.parent;
  // 부모 없이 열리면(새 탭) 아무것도 하지 않는다.
  if (!parentWin || parentWin === window) return;
  var ZOOMS = ${JSON.stringify(ARCHIFY_ZOOM_STEPS)};
  var MAX = ${ARCHIFY_FRAME_MAX_HEIGHT};
  html.setAttribute('data-kv-fit', '');
  // 창 높이를 틀과 무관한 고정값으로 보인다 — archify 의 화면 맞춤이 틀 높이와 고리를 이루지 않게.
  try {
    Object.defineProperty(window, 'innerHeight', { configurable: true, get: function () { return ${FIT_VIEWPORT_HEIGHT}; } });
  } catch (_) {}
  var parentOrigin = null;
  var last = -1;
  var frame = 0;
  var stamps = [];
  var halted = false;
  var lastWidth = window.innerWidth;
  // 내용 높이: body 상자 + 바깥 여백. 뷰포트에 묶인 최소 높이는 위 style 이 풀었다.
  function contentHeight() {
    var body = document.body;
    var style = window.getComputedStyle(body);
    var h = body.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
    return Math.min(MAX, Math.ceil(h));
  }
  // 높이가 1px 이상 바뀌면 알린다. 2초에 40번을 넘으면(진동) 폭이 바뀔 때까지 멈춘다.
  function measure() {
    frame = 0;
    if (parentOrigin === null || halted || !document.body) return;
    var h = contentHeight();
    if (Math.abs(h - last) < 1) return;
    var now = Date.now();
    stamps = stamps.filter(function (t) { return now - t < 2000; });
    if (stamps.length >= 40) {
      halted = true;
      try { console.warn('[knowledge-viewer] archify 틀 높이가 진동해 알림을 멈춘다'); } catch (_) {}
      return;
    }
    stamps.push(now);
    last = h;
    parentWin.postMessage({ type: '${FIT_HEIGHT}', height: h }, parentOrigin);
  }
  // 한 번에 한 번만 잰다. 다음 프레임에 재되, 프레임이 멈춘 때(화면 밖 교차 출처 iframe·숨은 탭)를 위해 200ms 타이머로도 잰다.
  function schedule() {
    if (frame) return;
    frame = 1;
    var done = false;
    var run = function () {
      if (done) return;
      done = true;
      measure();
    };
    window.requestAnimationFrame(run);
    window.setTimeout(run, 200);
  }
  // 배율을 html 속성·변수로 적용한다. 100 은 원래 그대로다.
  function applyZoom(zoom) {
    if (zoom === 100) {
      html.removeAttribute('data-kv-zoom');
      html.style.removeProperty('--kv-zoom');
    } else {
      html.setAttribute('data-kv-zoom', '');
      html.style.setProperty('--kv-zoom', String(zoom / 100));
    }
  }
  // 부모가 보낸 설정만 받는다: 보낸 창이 부모이고, 꼴이 맞고, 첫 설정의 출처와 같아야 한다.
  window.addEventListener('message', function (event) {
    if (event.source !== parentWin) return;
    var data = event.data;
    if (!data || typeof data !== 'object' || data.type !== '${FIT_SETTINGS}' || ZOOMS.indexOf(data.zoom) < 0) return;
    if (parentOrigin === null) {
      parentOrigin = event.origin;
      html.setAttribute('data-kv-fit-linked', '');
    } else if (event.origin !== parentOrigin) return;
    applyZoom(data.zoom);
    last = -1;
    schedule();
  });
  // 높이만 바뀐 resize 는 archify 에 넘기지 않는다 — 창 높이는 위에서 고정값으로 보였고, archify 의 도구줄 자리 재기
  // (resize 마다 여유를 0 으로 되돌렸다 다시 재는 viewer chrome)가 틀 높이와 진동하는 고리를 이룬다(실측 1314↔1358px).
  // 이 듣기는 archify 스크립트보다 먼저 걸리므로 같은 창의 뒤 듣기를 막을 수 있다. 폭이 바뀌면 그대로 넘기고 진동 멈춤도 푼다.
  window.addEventListener('resize', function (event) {
    if (window.innerWidth === lastWidth) {
      event.stopImmediatePropagation();
      return;
    }
    lastWidth = window.innerWidth;
    halted = false;
    stamps = [];
    schedule();
  }, true);
  // body 크기를 지켜본다. body 가 생기기 전이면 DOMContentLoaded 뒤에 건다.
  function observe() {
    if (typeof ResizeObserver === 'function') new ResizeObserver(schedule).observe(document.body);
    window.addEventListener('load', schedule);
    schedule();
  }
  if (document.body) observe();
  else document.addEventListener('DOMContentLoaded', observe);
  // 부모에게 섰다고 알린다(데이터 없음). 부모는 설정으로 답하고, 그 출처로만 높이를 보낸다.
  parentWin.postMessage({ type: '${FIT_READY}' }, '*');
})();`;

/** <head> 맨 앞에 넣을 조각. */
export const FIT_SNIPPET = `<style data-kv-fit>\n${FIT_STYLE}\n</style>\n<script data-kv-fit>\n${FIT_SCRIPT}\n</script>\n`;

/**
 * html 문자열에 맞춤 조각을 넣는다. 자리는 `<head>` 바로 뒤, 없으면 `<html>` 뒤, 없으면 doctype 뒤, 그것도 없으면 맨 앞이다.
 * doctype 앞에는 넣지 않는다(쿼크 모드가 된다). archify 의 첫 스크립트(테마)보다 먼저 돈다.
 */
export function injectArchifyFit(html: string): string {
  for (const re of [/<head(?:\s[^>]*)?>/i, /<html(?:\s[^>]*)?>/i, /<!doctype[^>]*>/i]) {
    const m = re.exec(html);
    if (m !== null) {
      const at = m.index + m[0].length;
      return html.slice(0, at) + '\n' + FIT_SNIPPET + html.slice(at);
    }
  }
  return FIT_SNIPPET + html;
}

/** `/raw` 응답 바이트에 맞춤을 적용할지: html 이고 쿼리가 `kv-fit=1` 일 때만. 아니면 null(그대로 낸다). */
export function fitRawBytes(rel: string, search: string, bytes: Buffer): Buffer | null {
  if (!/\.html?$/i.test(rel) || !wantsArchifyFit(search)) return null;
  return Buffer.from(injectArchifyFit(bytes.toString('utf8')), 'utf8');
}
