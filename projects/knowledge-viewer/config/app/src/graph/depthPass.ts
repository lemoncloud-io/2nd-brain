// 3D 지도의 프레임마다 하는 일: 깊이감(depth.ts)과 제목 가림(labels.ts)을 물체에 적용한다.
// three.js 가 장면을 그리기 직전(scene.onBeforeRender — 카메라 행렬은 이미 갱신됐다)에 한 번 부른다.
// 왜 매 프레임인가: 카메라가 돌 때도, 레이아웃이 움직일 때도 거리가 바뀐다. 둘을 따로 감지하는 것보다 매 프레임 O(노드 수)가
// 단순하고, 노드 2천여 개에 거리 계산·정렬·재질 교체는 그리기 비용에 비해 작다(실측은 README § Log).
import type { Camera, Fog, Group, Scene } from 'three';
import { Vector3 } from 'three';
import type SpriteText from 'three-spritetext';

import type { Kind } from '../../shared/kind.ts';
import { depthOf, depthRange, fogRange, isFront, opacityAt, quantize, scaleAt } from './depth.ts';
import { KIND_OFF_ALPHA, labelRole } from './kind-highlight.ts';
import { cullOverlaps, degreeOf, labelWidth } from './labels.ts';
import type { LabelBox, LabelMode } from './labels.ts';
import { LABEL_PX, addLabel, applyDepth, lookOf, sizeLabel } from './nodeObject.ts';

/** 겹침 판정에 쓰는 제목 상자의 높이 배수(글자 높이 대비 — 위아래 여백). */
const BOX_H = 1.4;
/** 호버한 노드와 중심은 겹침에서 늘 이긴다. */
const RANK_HOVER = Number.POSITIVE_INFINITY;
const RANK_CENTER = Number.MAX_SAFE_INTEGER;

export type DepthPassDeps = {
  scene: () => Scene;
  camera: () => Camera & { fov?: number };
  width: () => number;
  height: () => number;
  objs: ReadonlyMap<string, Group>;
  labels: Map<string, SpriteText>;
  center: () => string;
  hovered: () => string | null;
  labelMode: () => LabelMode;
  major: () => ReadonlySet<string>;
  /** 호버한 노드의 이웃(연결 수 상위 몇 개). */
  neighbors: (path: string) => readonly string[];
  /** 범례에서 강조한 종류(노드 호버 우선은 이 모듈이 labelRole 로 본다). 그 종류만 본래 밝기, 제목은 전부. */
  kind: () => Kind | null;
};

/** 프레임마다 부를 함수를 만든다. 버퍼는 한 번 만들어 재사용한다. */
export function createDepthPass(d: DepthPassDeps): () => void {
  const px = (f: { t: number }): number => LABEL_PX * scaleAt(f.t);
  let dists = new Float64Array(0);
  const v = new Vector3();
  const boxes: LabelBox[] = [];
  /** 후보 노드의 깊이 t 와 카메라 거리, 흐리게 그리는가. 제목 크기·불투명도에 쓴다. */
  const front = new Map<string, { t: number; dist: number; dim: boolean }>();

  return () => {
    const objs = d.objs;
    const n = objs.size;
    if (n === 0) return;
    const cam = d.camera();
    if (dists.length < n) dists = new Float64Array(n);
    let i = 0;
    for (const obj of objs.values()) dists[i++] = obj.position.distanceTo(cam.position);
    const range = depthRange(dists.subarray(0, n));
    const fog = d.scene().fog as Fog | null;
    if (fog !== null) {
      const f = fogRange(range.near, range.far);
      fog.near = f.near;
      fog.far = f.far;
    }

    const mode = d.labelMode();
    const hovered = d.hovered();
    const kind = hovered === null ? d.kind() : null;
    const center = d.center();
    const major = d.major();
    const near = hovered === null ? null : new Set(d.neighbors(hovered));
    const W = d.width();
    const H = d.height();
    // 원근: 카메라 거리 d 에서 그래프 좌표 1 은 화면 H / (2 · d · tan(fov/2)) px 다. 제목은 화면 크기(LABEL_PX × 깊이 배수)로 맞추므로
    // 겹침 상자도 그 크기로 재고, 스프라이트의 그래프 좌표 높이는 거꾸로 환산한다.
    const halfTan = Math.tan(((cam.fov ?? 75) * Math.PI) / 360);
    boxes.length = 0;
    front.clear();

    i = 0;
    for (const [path, obj] of objs) {
      const dist = dists[i++];
      const t = depthOf(dist, range.near, range.far);
      const scale = scaleAt(t);
      obj.scale.setScalar(scale);
      const look = lookOf(obj);
      if (look === undefined) continue;
      // 범례 종류 강조: 다른 종류는 흐리게, 그 종류의 제목은 선별·겹침·앞쪽 규칙 없이 전부(force).
      const dim = kind !== null && look.node.kind !== kind;
      applyDepth(look, quantize(t), dim);

      const isHover = path === hovered;
      // 중심은 원점에 고정돼 늘 가운데 깊이(t ≈ 0.5)다 — 호버한 노드처럼 깊이와 무관하게 또렷이 보인다.
      const pinned = isHover || path === center;
      const base = mode === 'all' || isHover || (mode === 'major' && (major.has(path) || (near !== null && near.has(path))));
      const role = labelRole(look.node, base, kind, hovered);
      const force = role === 'force';
      if (role === 'skip' || (!pinned && !force && !isFront(t))) continue;
      v.copy(obj.position).project(cam);
      if (v.z > 1) continue; // 카메라 뒤
      const px = LABEL_PX * (pinned ? 1 : scale);
      boxes.push({
        id: path,
        x: ((v.x + 1) / 2) * W,
        // 제목은 노드 위에 붙는다 — 상자도 그만큼 올린다(대략 글자 높이 하나).
        y: ((1 - v.y) / 2) * H - px,
        w: labelWidth(look.node.title, px),
        h: px * BOX_H,
        rank: isHover ? RANK_HOVER : path === center ? RANK_CENTER : degreeOf(look.node),
        force,
      });
      front.set(path, { t: pinned ? 0 : t, dist, dim });
    }

    const kept = cullOverlaps(boxes);
    for (const [path, label] of d.labels) if (!kept.has(path)) label.visible = false;
    for (const path of kept) {
      let label = d.labels.get(path);
      if (label === undefined) {
        const obj = objs.get(path);
        const look = obj === undefined ? undefined : lookOf(obj);
        if (obj === undefined || look === undefined) continue;
        label = addLabel(obj, look.node);
        d.labels.set(path, label);
      }
      const f = front.get(path);
      if (f === undefined) continue;
      label.visible = true;
      label.material.opacity = opacityAt(f.t) * (f.dim ? KIND_OFF_ALPHA : 1);
      // 화면 LABEL_PX × 깊이 배수 크기. 물체(그룹) 자체도 scaleAt(t) 로 커졌으므로 그만큼 나눈다.
      const group = objs.get(path);
      const look = group === undefined ? undefined : lookOf(group);
      if (group === undefined || look === undefined) continue;
      const hWorld = (px(f) * 2 * Math.max(f.dist, 1) * halfTan) / H / group.scale.y;
      sizeLabel(label, look.node, hWorld);
    }
  };
}
