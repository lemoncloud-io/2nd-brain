// 2D 카메라(d3-zoom 변환)의 움직임 — 패닝 관성·로그 공간 휠 확대·전환(집 보기·맞춤) 스프링. 규칙은 motion.ts(순수)다.
//
// force-graph 1.52 는 안의 d3-zoom 객체를 내주지 않는다(interpolateZoom·transition 을 걸 수 없다). 그래서:
// - 패닝: d3-zoom 이 드래그하는 동안 onZoom 으로 중심 좌표 표본을 모으고, 놓는 순간(onZoomEnd) 속도를 재서 미끄러뜨린다.
// - 휠: d3-zoom 의 휠(한 번에 배율 점프)을 끄고(enableZoomInteraction(false)) 우리가 받아 ln k 의 속도로 쌓는다.
//   한 번의 거리는 d3 기본(2^(−deltaY·0.002))과 같아 바로 모드와 같은 배율에 닿고, 포인터 아래 좌표는 그대로다(zoomAbout).
// - 적용은 라이브러리의 centerAt()·zoom() 으로 프레임마다 한다. 우리가 부른 것도 onZoom 을 울리므로 applying 으로 가려 입력과 구분한다.
// 라이브러리의 그리기 루프는 따로 돌고(움직이면 다시 그린다), 우리 rAF 는 움직임이 있을 때만 돌다 멈추면 쉰다.
import {
  FLY_IN_FROM,
  clampDt,
  decayOver,
  decayVelocity,
  homeZoom,
  impulseFor,
  omegaFor,
  pushSample,
  settled,
  springStep,
  velocityOf,
  wheelLogDelta,
  zoomAbout,
  zoomBy,
} from './motion.ts';
import type { MotionSettings, Point, Sample, Spring } from './motion.ts';
import { resetView2d } from './interaction.ts';

/** force-graph 에서 쓰는 것만. */
export type Fg2 = {
  centerAt(): Point;
  centerAt(x: number, y: number): unknown;
  zoom(): number;
  zoom(k: number): unknown;
  zoomToFit(durationMs: number, padding: number): unknown;
  screen2GraphCoords(x: number, y: number): Point;
  getGraphBbox(): { x: [number, number]; y: [number, number] } | null;
  width(): number;
  height(): number;
  onZoom(cb: (t: { k: number; x: number; y: number }) => void): unknown;
  onZoomEnd(cb: (t: { k: number; x: number; y: number }) => void): unknown;
  enableZoomInteraction(enable: boolean): unknown;
};

/** 패닝이 화면에서 이보다 느리면 멈춘 것이다(px/ms — 초당 20 px). */
const STOP_PAN_PX_PER_MS = 0.02;
/** 확대가 이보다 느리면 멈춘 것이다(ln k / ms — 초당 0.5 %). */
const STOP_ZOOM_PER_MS = 5e-6;
/** 전환이 닿은 것으로 치는 오차 — 중심은 그래프 좌표 0.5, 배율은 ln k 0.005. */
const SETTLE_CENTER = 0.5;
const SETTLE_LOG = 0.005;

type Transition = { cx: Spring; cy: Spring; lk: Spring; to: { x: number; y: number; lk: number }; omega: number };

export type Camera2d = {
  setMotion(m: MotionSettings): void;
  /** 지도를 통째로 옮긴 만큼 중심도 옮긴다 — 화면은 그대로다. */
  shift(dx: number, dy: number): void;
  /** 집 보기: 중심 (0,0)·노드 수에 맞는 배율. farStart 면 FLY_IN_FROM 배 작은 배율에서 출발한다. */
  goHome(nodeCount: number, o?: { farStart?: boolean }): void;
  /** 지도 전체가 보이게 맞춘다(zoomToFit 과 같은 목표, 스프링으로). */
  fit(padding: number): void;
  /** 초기 보기(Space): 중심 (0,0)·노드 수에 맞는 배율. */
  reset(nodeCount: number): void;
  moving(): boolean;
  dispose(): void;
};

export function createCamera2d(
  fg: Fg2,
  el: HTMLElement,
  env: { raf: (cb: (t: number) => void) => number; caf: (id: number) => void; now: () => number } = {
    raf: (cb) => requestAnimationFrame(cb),
    caf: (id) => cancelAnimationFrame(id),
    now: () => performance.now(),
  },
): Camera2d {
  let settings: MotionSettings = { smooth: true, damping: 0.92, transitionMs: 600 };
  let applying = false;
  let samples: Sample[] = [];
  let glide: Point = { x: 0, y: 0 };
  let vLog = 0;
  let pointer: Point | null = null;
  let transition: Transition | null = null;
  let rafId = 0;
  let lastT: number | null = null;

  const active = () => glide.x !== 0 || glide.y !== 0 || vLog !== 0 || transition !== null;
  const setCenter = (x: number, y: number) => {
    applying = true;
    fg.centerAt(x, y);
    applying = false;
  };
  /** 배율을 k2 로 — 포인터(없으면 화면 가운데) 아래 그래프 좌표는 그대로. 라이브러리가 scaleExtent 로 자른 실제 배율로 중심을 맞춘다. */
  const setZoom = (k2: number) => {
    const k = fg.zoom();
    const c = fg.centerAt();
    const p = pointer === null ? c : fg.screen2GraphCoords(pointer.x, pointer.y);
    applying = true;
    fg.zoom(k2);
    const kk = fg.zoom();
    const n = zoomAbout(c, p, k, kk);
    fg.centerAt(n.x, n.y);
    applying = false;
  };
  /** 입력이 왔다 — 관성·전환을 끊고 입력을 따른다. */
  const interrupt = () => {
    glide = { x: 0, y: 0 };
    vLog = 0;
    transition = null;
  };

  const frame = (now: number) => {
    // 관성(미끄러짐·휠)은 한 프레임 상한(clampDt)으로 — 멈춘 시간만큼 한 번에 건너뛰지 않게. 전환(스프링)은 실제 지난 시간으로 —
    // 탭이 멈췄다 깨어나면 그동안 끝났어야 할 전환은 끝난 자리로 간다(닫힌 해라 큰 dt 도 안전하다).
    const raw = lastT === null ? 0 : Math.max(0, now - lastT);
    const dt = clampDt(raw);
    lastT = now;
    if (dt > 0) {
      if (glide.x !== 0 || glide.y !== 0) {
        const c = fg.centerAt();
        setCenter(c.x + glide.x * dt, c.y + glide.y * dt);
        const f = decayOver(settings.damping, dt);
        const nx = glide.x * f;
        const ny = glide.y * f;
        // 두 축을 따로 멈추면 비스듬한 미끄러짐이 한 축씩 꺾인다 — 화면 속도(px/ms)로 같이 본다.
        glide = Math.hypot(nx, ny) * fg.zoom() < STOP_PAN_PX_PER_MS ? { x: 0, y: 0 } : { x: nx, y: ny };
      }
      if (vLog !== 0) {
        setZoom(zoomBy(fg.zoom(), vLog, dt));
        vLog = decayVelocity(vLog, settings.damping, dt, STOP_ZOOM_PER_MS);
      }
      const t = transition;
      if (t !== null) {
        t.cx = springStep(t.cx, t.to.x, raw, t.omega);
        t.cy = springStep(t.cy, t.to.y, raw, t.omega);
        t.lk = springStep(t.lk, t.to.lk, raw, t.omega);
        const done =
          settled(t.cx, t.to.x, t.omega, SETTLE_CENTER) && settled(t.cy, t.to.y, t.omega, SETTLE_CENTER) && settled(t.lk, t.to.lk, t.omega, SETTLE_LOG);
        applying = true;
        fg.zoom(Math.exp(done ? t.to.lk : t.lk.x));
        fg.centerAt(done ? t.to.x : t.cx.x, done ? t.to.y : t.cy.x);
        applying = false;
        if (done) transition = null;
      }
    }
    if (active()) rafId = env.raf(frame);
    else {
      rafId = 0;
      lastT = null;
    }
  };
  const wake = () => {
    if (rafId !== 0) return;
    lastT = null;
    rafId = env.raf(frame);
  };
  /** 지금 위치에서 목표로 스프링을 건다. 전환 중이면 속도를 이어받는다. */
  const go = (to: { x: number; y: number; lk: number }) => {
    if (!settings.smooth) {
      applying = true;
      fg.zoom(Math.exp(to.lk));
      fg.centerAt(to.x, to.y);
      applying = false;
      transition = null;
      return;
    }
    const c = fg.centerAt();
    const prev = transition;
    transition = {
      cx: { x: c.x, v: prev?.cx.v ?? glide.x },
      cy: { x: c.y, v: prev?.cy.v ?? glide.y },
      lk: { x: Math.log(fg.zoom()), v: prev?.lk.v ?? vLog },
      to,
      omega: omegaFor(settings.transitionMs),
    };
    glide = { x: 0, y: 0 };
    vLog = 0;
    wake();
  };

  fg.onZoom((t) => {
    if (applying) return;
    interrupt();
    samples = pushSample(samples, { t: env.now(), x: t.x, y: t.y, k: t.k });
  });
  fg.onZoomEnd(() => {
    if (applying) return;
    const v = velocityOf(samples, env.now());
    samples = [];
    if (!settings.smooth || (v.x === 0 && v.y === 0)) return;
    glide = v;
    wake();
  });
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const box = el.getBoundingClientRect();
    pointer = { x: e.clientX - box.left, y: e.clientY - box.top };
    const dl = wheelLogDelta(e.deltaY, e.deltaMode, e.ctrlKey);
    transition = null;
    if (!settings.smooth) {
      setZoom(fg.zoom() * Math.exp(dl));
      return;
    }
    vLog += impulseFor(dl, settings.damping);
    wake();
  };
  // 손이 닿으면 미끄러짐이 멈춘다(실제 물체처럼). 드래그가 이어지면 onZoom 이 표본을 다시 모은다.
  const onPointerDown = () => interrupt();
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('pointerdown', onPointerDown);
  fg.enableZoomInteraction(false);

  return {
    setMotion(m) {
      settings = m;
      if (!m.smooth) {
        const t = transition;
        if (t !== null) go(t.to);
        glide = { x: 0, y: 0 };
        vLog = 0;
      }
    },
    shift(dx, dy) {
      const c = fg.centerAt();
      setCenter(c.x + dx, c.y + dy);
      if (transition !== null) {
        transition.cx.x += dx;
        transition.cy.x += dy;
      }
    },
    goHome(nodeCount, o = {}) {
      const lk = Math.log(homeZoom(nodeCount));
      if (o.farStart && settings.smooth) {
        applying = true;
        fg.zoom(Math.exp(lk) / FLY_IN_FROM);
        fg.centerAt(0, 0);
        applying = false;
      }
      go({ x: 0, y: 0, lk });
    },
    reset(nodeCount) {
      const r = resetView2d(nodeCount);
      go({ x: r.center[0], y: r.center[1], lk: Math.log(r.zoom) });
    },
    fit(padding) {
      const bbox = fg.getGraphBbox();
      if (bbox === null) return;
      if (!settings.smooth) {
        applying = true;
        fg.zoomToFit(0, padding);
        applying = false;
        transition = null;
        return;
      }
      const w = bbox.x[1] - bbox.x[0];
      const h = bbox.y[1] - bbox.y[0];
      // zoomToFit 과 같은 식. 지도가 점 하나면 배율은 그대로 둔다.
      const k = w <= 0 || h <= 0 ? fg.zoom() : Math.max(1e-12, Math.min(1e12, (fg.width() - padding * 2) / w, (fg.height() - padding * 2) / h));
      go({ x: (bbox.x[0] + bbox.x[1]) / 2, y: (bbox.y[0] + bbox.y[1]) / 2, lk: Math.log(k) });
    },
    moving: () => transition !== null,
    dispose() {
      if (rafId !== 0) env.caf(rafId);
      rafId = 0;
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      interrupt();
    },
  };
}
