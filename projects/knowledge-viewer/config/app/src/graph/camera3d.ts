// 3D 카메라의 움직임 — TrackballControls 의 관성과 집 보기 전환(스프링). 규칙은 motion.ts(순수), 여기는 three 에 붙이는 층이다.
//
// 관성은 라이브러리 것을 쓴다: 3d-force-graph 1.80 은 three-render-objects 를 거쳐 TrackballControls(controlType 'trackball')를 만들고
// 프레임마다 controls.update() 를 부른다. 그 컨트롤은 staticMoving=false 면 회전·패닝·확대 잔여량을 프레임마다 dynamicDampingFactor 로
// 줄인다 — 이것이 관성이다. 자체 구현은 하지 않고 그 계수만 설정(감쇠 강도)과 실제 프레임 길이에 맞춘다. 휠 확대는 컨트롤이
// 눈 벡터에 배수를 곱하므로(거리의 로그 공간) 가까울 때 과하게 빨라지지 않는다.
// 전환(집 보기 — 중심 원점·노드 수에 맞는 거리)은 라이브러리의 cameraPosition 트윈(Quadratic.Out, 입력으로 못 끊음) 대신
// 임계 감쇠 스프링으로 위치·주시점을 프레임마다 옮긴다. 사용자 입력(컨트롤의 'start')이 오면 끊고 입력을 따른다.
// 프레임 일은 depthPass 와 같은 자리(scene.onBeforeRender)에서 돈다 — rAF 를 더 만들지 않는다.
import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';

import { INITIAL_ROTATE, markInput, rotateStep } from './autorotate.ts';
import type { RotateState } from './autorotate.ts';
import { resetView3d } from './interaction.ts';
import { FLY_IN_FROM, FRAME_MS, clampDt, homeDistance, omegaFor, settled, springStep, trackballDampingFactor, trackballZoomSpeed } from './motion.ts';
import type { MotionSettings, Spring } from './motion.ts';

/** TrackballControls 에서 쓰는 것만. 3d-force-graph 는 controls() 를 object 로 내준다. */
export type Trackball = {
  staticMoving: boolean;
  dynamicDampingFactor: number;
  zoomSpeed: number;
  target: Vector3;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

type Axes = [Spring, Spring, Spring];
/**
 * 전환은 주시점·보는 방향(단위 벡터)·거리를 따로 스프링한다 — 위치 = 주시점 + 방향 × 거리. 위치를 곧장 보간하면 반대편으로 가는
 * 초기 보기(Space)가 지도 한가운데를 뚫고 지나간다(실측: 거리 1392 → 630 → 1392). 방향을 성분마다 스프링하고 정규화하면 둘레를 돈다.
 * up 은 초기 보기에서만 스프링을 건다 — 트랙볼이 돌려 둔 카메라의 위쪽을 +y 로 되돌린다.
 */
type Transition = { look: Axes; dir: Axes; dist: Spring; up: Axes | null; lookTo: Vector3; dirTo: Vector3; distTo: number; upTo: Vector3 | null; omega: number };

/** 목표에 닿은 것으로 치는 거리(그래프 좌표). 카메라 거리는 수백이다. */
const SETTLE_EPS = 0.5;

export type Camera3d = {
  /** 설정(부드럽게·바로·감쇠)을 바꾼다. 바로면 컨트롤의 관성을 끄고 전환은 즉시다. */
  setMotion(m: MotionSettings): void;
  /** 지도를 통째로 옮긴 만큼 카메라·주시점도 옮긴다 — 화면은 그대로다. */
  shift(dx: number, dy: number, dz: number): void;
  /** 집 보기로 간다: 보던 방향은 두고 주시점은 원점, 거리는 노드 수에 맞게. farStart 면 FLY_IN_FROM 배 먼 데서 출발한다. */
  goHome(nodeCount: number, o?: { farStart?: boolean }): void;
  /** 초기 보기로 간다: +z 축 위 집 거리에서 원점을 보고 위쪽은 +y — 각도까지 되돌린다(Space). */
  reset(nodeCount: number): void;
  /** 매 프레임(그리기 직전). 감쇠 계수를 dt 에 맞추고 전환을 한 걸음 옮긴다. */
  frame(now: number): void;
  /** 전환 중인가. */
  moving(): boolean;
  /** 자동 회전(유휴 시 주시점의 위쪽 축으로 천천히 돈다). paused 가 참이면(호버 중 등) 돌지 않는다. */
  setAutoRotate(on: boolean): void;
  dispose(): void;
};

const axes = (v: Vector3, vel: readonly number[] = [0, 0, 0]): Axes => [
  { x: v.x, v: vel[0] ?? 0 },
  { x: v.y, v: vel[1] ?? 0 },
  { x: v.z, v: vel[2] ?? 0 },
];

export function createCamera3d(d: { camera: () => PerspectiveCamera; controls: () => Trackball; paused?: () => boolean }): Camera3d {
  let settings: MotionSettings = { smooth: true, damping: 0.92, transitionMs: 600 };
  let rotate: RotateState = INITIAL_ROTATE;
  const rotAxis = new Vector3();
  let transition: Transition | null = null;
  let lastT: number | null = null;
  const eye = new Vector3();
  const tmpPos = new Vector3();
  const tmpLook = new Vector3();
  const tmpUp = new Vector3();
  const tmpDir = new Vector3();
  /** 지금 카메라의 보는 방향(주시점 → 카메라, 단위)과 거리. 겹쳐 있으면 +z. */
  const eyeOf = (): { dir: Vector3; dist: number } => {
    const cam = d.camera();
    eye.subVectors(cam.position, d.controls().target);
    const dist = eye.length();
    if (dist === 0) eye.set(0, 0, 1);
    else eye.divideScalar(dist);
    return { dir: eye, dist };
  };
  /** 전환을 건다. 진행 중이면 속도를 이어받는다. 방향이 정반대면 살짝 비껴 세워 정규화가 0 으로 나누지 않게 한다. */
  const start = (lookTo: Vector3, dirTo: Vector3, distTo: number, upTo: Vector3 | null) => {
    const c = d.controls();
    const { dir, dist } = eyeOf();
    if (dir.dot(dirTo) < -0.999) dir.applyAxisAngle(Math.abs(dirTo.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0), 0.05).normalize();
    const prev = transition;
    transition = {
      look: axes(c.target, prev?.look.map((s) => s.v)),
      dir: axes(dir, prev?.dir.map((s) => s.v)),
      dist: { x: dist, v: prev?.dist.v ?? 0 },
      up: upTo === null ? null : axes(d.camera().up),
      lookTo,
      dirTo: dirTo.clone().normalize(),
      distTo,
      upTo,
      omega: omegaFor(settings.transitionMs),
    };
  };
  const placeTo = (t: Transition) => place(tmpPos.copy(t.dirTo).multiplyScalar(t.distTo).add(t.lookTo), t.lookTo, t.upTo ?? undefined);

  const place = (pos: Vector3, look: Vector3, up?: Vector3) => {
    const cam = d.camera();
    cam.position.copy(pos);
    d.controls().target.copy(look);
    if (up !== undefined && up.lengthSq() > 0) cam.up.copy(up).normalize();
    cam.lookAt(look);
    // three 는 onBeforeRender 전에 카메라 행렬을 갱신했다. 여기서 옮겼으니 다시 갱신해야 이번 프레임에 반영된다.
    cam.updateMatrixWorld();
  };
  // 사용자 입력(드래그·휠)이 오면 전환을 끊고 입력을 따른다. 자동 회전도 멈추고 유휴 시계를 다시 센다(놓은 뒤 관성이 끝날 즈음 다시 돈다).
  const cancel = () => {
    transition = null;
    rotate = markInput(rotate, performance.now());
  };
  const touched = () => {
    rotate = markInput(rotate, performance.now());
  };
  d.controls().addEventListener('start', cancel);
  d.controls().addEventListener('end', touched);

  return {
    setMotion(m) {
      settings = m;
      const c = d.controls();
      c.staticMoving = !m.smooth;
      c.dynamicDampingFactor = trackballDampingFactor(m.damping);
      // 바로 모드도 휠 한 번에 같은 거리를 가게 — 실측(2026-10-23): 기본값 그대로면 바로 모드가 7 배 덜 갔다.
      c.zoomSpeed = trackballZoomSpeed(m.smooth, m.damping);
      if (!m.smooth && transition !== null) {
        placeTo(transition);
        transition = null;
      }
    },
    shift(dx, dy, dz) {
      const cam = d.camera();
      const c = d.controls();
      cam.position.x += dx;
      cam.position.y += dy;
      cam.position.z += dz;
      c.target.x += dx;
      c.target.y += dy;
      c.target.z += dz;
      if (transition !== null) {
        // 진행 중인 전환의 지금 주시점도 같이 옮긴다(방향·거리는 그대로) — 목표는 원점(집 보기)이라 그대로 둔다.
        const delta = [dx, dy, dz];
        for (let i = 0; i < 3; i += 1) transition.look[i]!.x += delta[i]!;
      }
      cam.updateMatrixWorld();
    },
    goHome(nodeCount, o = {}) {
      const dist = homeDistance(nodeCount);
      const lookTo = new Vector3(0, 0, 0);
      const dirTo = eyeOf().dir.clone();
      if (!settings.smooth) {
        place(dirTo.multiplyScalar(dist), lookTo);
        transition = null;
        return;
      }
      if (o.farStart) place(dirTo.clone().multiplyScalar(dist * FLY_IN_FROM), lookTo);
      // 전환 중에 또 부르면 지금 속도를 이어받는다 — 끊기지 않는다.
      start(lookTo, dirTo, dist, null);
    },
    reset(nodeCount) {
      const r = resetView3d(nodeCount);
      const lookTo = new Vector3(...r.lookAt);
      const upTo = new Vector3(...r.up);
      const posTo = new Vector3(...r.position);
      const dirTo = posTo.clone().sub(lookTo).normalize();
      if (!settings.smooth) {
        place(posTo, lookTo, upTo);
        transition = null;
        return;
      }
      start(lookTo, dirTo, posTo.distanceTo(lookTo), upTo);
    },
    frame(now) {
      // 전환은 실제 지난 시간으로 간다 — 탭이 멈췄다 깨어나면 그동안 끝났어야 할 전환은 끝난 자리로 간다(닫힌 해라 큰 dt 도 안전하다).
      // 컨트롤 감쇠 계수만 한 프레임 상한(clampDt)으로 — 멈춘 시간만큼 관성이 더 미끄러지지 않게.
      const raw = lastT === null ? 0 : Math.max(0, now - lastT);
      const dt = clampDt(raw);
      lastT = now;
      // 컨트롤의 감쇠는 프레임마다 곱한다. 이번 프레임 길이에 맞춘 계수를 다음 update() 가 쓴다 — 30 fps 에서도 같은 시간에 멈춘다.
      if (settings.smooth) d.controls().dynamicDampingFactor = trackballDampingFactor(settings.damping, dt > 0 ? dt : FRAME_MS);
      const t = transition;
      if (t === null) {
        // 전환이 없을 때만 자동 회전 — 주시점의 위쪽 축(카메라 up)으로 돈다. 바로 모드(움직임 줄이기)는 돌지 않는다.
        if (raw === 0) return;
        const blocked = !settings.smooth || (d.paused?.() ?? false);
        const r = rotateStep(rotate, now, dt, blocked);
        rotate = r.state;
        if (r.angle !== 0) {
          const cam = d.camera();
          const c = d.controls();
          rotAxis.copy(cam.up).normalize();
          tmpPos.copy(cam.position).sub(c.target).applyAxisAngle(rotAxis, r.angle).add(c.target);
          place(tmpPos, c.target);
        }
        return;
      }
      if (raw === 0) return;
      let done = true;
      const step = (s: Spring, target: number, eps: number): Spring => {
        const n = springStep(s, target, raw, t.omega);
        if (!settled(n, target, t.omega, eps)) done = false;
        return n;
      };
      // 방향(단위 벡터)은 성분 오차 0.001, 주시점·거리는 그래프 좌표 0.5 로 닿은 것으로 친다.
      t.look = [step(t.look[0], t.lookTo.x, SETTLE_EPS), step(t.look[1], t.lookTo.y, SETTLE_EPS), step(t.look[2], t.lookTo.z, SETTLE_EPS)];
      t.dir = [step(t.dir[0], t.dirTo.x, 1e-3), step(t.dir[1], t.dirTo.y, 1e-3), step(t.dir[2], t.dirTo.z, 1e-3)];
      t.dist = step(t.dist, t.distTo, SETTLE_EPS);
      if (t.up !== null && t.upTo !== null) t.up = [step(t.up[0], t.upTo.x, 1e-3), step(t.up[1], t.upTo.y, 1e-3), step(t.up[2], t.upTo.z, 1e-3)];
      if (done) {
        placeTo(t);
        transition = null;
        return;
      }
      tmpLook.set(t.look[0].x, t.look[1].x, t.look[2].x);
      tmpDir.set(t.dir[0].x, t.dir[1].x, t.dir[2].x);
      if (tmpDir.lengthSq() < 1e-12) tmpDir.copy(t.dirTo);
      tmpDir.normalize();
      tmpPos.copy(tmpDir).multiplyScalar(t.dist.x).add(tmpLook);
      if (t.up !== null) tmpUp.set(t.up[0].x, t.up[1].x, t.up[2].x);
      place(tmpPos, tmpLook, t.up === null ? undefined : tmpUp);
    },
    moving: () => transition !== null,
    setAutoRotate(on) {
      rotate = { ...rotate, enabled: on, spinningSince: null };
    },
    dispose() {
      d.controls().removeEventListener('start', cancel);
      d.controls().removeEventListener('end', touched);
      transition = null;
    },
  };
}
